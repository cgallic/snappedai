#!/usr/bin/env node
// Ask AI - Interactive Q&A for Snapped Report
// Answers questions using live market data + synthesis

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3883;

// Load from .env
let OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
if (!OPENROUTER_KEY) {
  try {
    const envFile = fs.readFileSync('/var/www/snap/.env', 'utf8');
    const match = envFile.match(/OPENROUTER_API_KEY=(.+)/);
    if (match) OPENROUTER_KEY = match[1].trim();
  } catch (e) { console.log('[ASK-AI] Warning: Could not load .env'); }
}
const THREADS_FILE = path.join(__dirname, 'ask-threads.json');
const QUESTIONS_LOG = path.join(__dirname, 'questions-log.json');

// Rate limiting: 10 questions per hour per IP
const rateLimits = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

// Load/save threads
function loadThreads() {
  try {
    return JSON.parse(fs.readFileSync(THREADS_FILE, 'utf8'));
  } catch { return {}; }
}

function saveThreads(threads) {
  fs.writeFileSync(THREADS_FILE, JSON.stringify(threads, null, 2));
}

// Log questions for analytics
function logQuestion(question, ip) {
  try {
    const log = JSON.parse(fs.readFileSync(QUESTIONS_LOG, 'utf8'));
    log.push({ question, ip: ip.replace(/[0-9]+\.[0-9]+$/, 'x.x'), timestamp: new Date().toISOString() });
    // Keep last 1000
    if (log.length > 1000) log.splice(0, log.length - 1000);
    fs.writeFileSync(QUESTIONS_LOG, JSON.stringify(log, null, 2));
  } catch {
    fs.writeFileSync(QUESTIONS_LOG, JSON.stringify([{ question, timestamp: new Date().toISOString() }], null, 2));
  }
}

// Rate limit check
function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimits.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_WINDOW;
  }
  
  if (record.count >= RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  rateLimits.set(ip, record);
  return true;
}

// Fetch current context
async function getContext() {
  const context = {};
  
  try {
    // Synthesis report
    const synthesis = JSON.parse(fs.readFileSync(path.join(__dirname, 'synthesized-report.json'), 'utf8'));
    context.synthesis = synthesis;
  } catch { context.synthesis = null; }
  
  try {
    // Live markets
    const markets = await fetch('http://localhost:3881/markets').then(r => r.json());
    context.markets = markets.instruments;
    context.spreads = markets.spreads;
  } catch { context.markets = null; }
  
  try {
    // Watchlist
    context.watchlist = await fetch('http://localhost:3880/watchlist').then(r => r.json());
  } catch { context.watchlist = null; }
  
  try {
    // Alerts
    context.alerts = await fetch('http://localhost:3879/alerts').then(r => r.json());
  } catch { context.alerts = []; }
  
  return context;
}

// Build prompt
function buildPrompt(question, context, threadHistory) {
  const m = context.markets || {};
  const s = context.synthesis || {};
  
  let prompt = `You are a macro analyst assistant helping users understand today's market data. Be conversational, specific, and actionable.

CURRENT MARKET SNAPSHOT (live):
- BTC: $${m['BTC-USD']?.price?.toFixed(0) || '?'} (${m['BTC-USD']?.change || '?'}%)
- ETH: $${m['ETH-USD']?.price?.toFixed(0) || '?'} (${m['ETH-USD']?.change || '?'}%)
- WTI Crude: $${m['CL=F']?.price?.toFixed(2) || '?'} (${m['CL=F']?.change || '?'}%)
- Brent: $${m['BZ=F']?.price?.toFixed(2) || '?'} (${m['BZ=F']?.change || '?'}%)
- Brent-WTI Spread: $${context.spreads?.brentWti || '?'}
- Gold: $${m['GC=F']?.price?.toFixed(0) || '?'} (${m['GC=F']?.change || '?'}%)
- S&P 500: ${m['^SPX']?.price?.toFixed(0) || '?'} (${m['^SPX']?.change || '?'}%)
- VIX: ${m['^VIX']?.price?.toFixed(2) || '?'} (${m['^VIX']?.change || '?'}%)
- Dollar Index: ${m['DX-Y.NYB']?.price?.toFixed(2) || '?'}

TODAY'S AI ANALYSIS:
- Summary: ${s.summary || 'Not available'}
- Regime: ${s.regime?.current || '?'} - ${s.regime?.reasoning || ''}

CRITICAL SIGNALS:
${(s.criticalSignals || []).map(sig => `- [${sig.severity}] ${sig.signal}`).join('\n') || 'None'}

DOWNSTREAM EFFECTS:
${(s.downstreamEffects || []).map(d => `- ${d.trigger} → ${d.chain?.join(' → ')}`).join('\n') || 'None'}

POSITIONING IDEAS:
${(s.positioning || []).map(p => `- ${p.trade}: ${p.reasoning}`).join('\n') || 'None'}

ACTIVE ALERTS:
${(context.alerts || []).slice(0, 5).map(a => `- ${a.message}`).join('\n') || 'None'}

`;

  if (threadHistory && threadHistory.length > 0) {
    prompt += `\nPREVIOUS CONVERSATION:\n`;
    threadHistory.forEach(msg => {
      prompt += `${msg.role === 'user' ? 'User' : 'You'}: ${msg.content}\n`;
    });
  }

  prompt += `\nUser question: ${question}

Answer conversationally. Reference specific data points. If they ask about personal impact, relate it to everyday things (gas prices, grocery costs, portfolio). If they ask about trades, give specific instruments and conditions. Keep it under 200 words unless they ask for detail.`;

  return prompt;
}

// Ask LLM
async function askLLM(question, context, threadHistory) {
  const prompt = buildPrompt(question, context, threadHistory);
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://snappedai.com',
      'X-Title': 'Snapped Report Ask AI'
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a helpful macro analyst. Be specific, use actual numbers, and be conversational.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    })
  });
  
  const result = await response.json();
  return result.choices?.[0]?.message?.content || 'I couldn\'t analyze that right now. Try asking about specific markets like oil, crypto, or stocks.';
}

// HTTP server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  
  // Health check
  if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }
  
  // Question analytics
  if (req.url === '/analytics') {
    try {
      const log = JSON.parse(fs.readFileSync(QUESTIONS_LOG, 'utf8'));
      const last24h = log.filter(q => new Date(q.timestamp) > new Date(Date.now() - 24*60*60*1000));
      res.end(JSON.stringify({
        total: log.length,
        last24h: last24h.length,
        topQuestions: last24h.slice(-20).map(q => q.question)
      }));
    } catch {
      res.end(JSON.stringify({ total: 0, last24h: 0, topQuestions: [] }));
    }
    return;
  }
  
  // Ask endpoint
  if (req.url === '/ask' && req.method === 'POST') {
    // Rate limit
    if (!checkRateLimit(ip)) {
      res.writeHead(429);
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in an hour.', remaining: 0 }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { question, threadId } = JSON.parse(body);
        
        if (!question || question.length < 3) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Question too short' }));
          return;
        }
        
        // Log question
        logQuestion(question, ip);
        
        // Get context
        const context = await getContext();
        
        // Thread handling
        const threads = loadThreads();
        const tid = threadId || crypto.randomUUID();
        const thread = threads[tid] || { messages: [], created: new Date().toISOString() };
        
        // Get answer
        const answer = await askLLM(question, context, thread.messages);
        
        // Update thread
        thread.messages.push({ role: 'user', content: question });
        thread.messages.push({ role: 'assistant', content: answer });
        thread.updated = new Date().toISOString();
        
        // Keep threads small (last 10 exchanges)
        if (thread.messages.length > 20) {
          thread.messages = thread.messages.slice(-20);
        }
        
        threads[tid] = thread;
        saveThreads(threads);
        
        // Clean old threads (>24h)
        const dayAgo = Date.now() - 24*60*60*1000;
        Object.keys(threads).forEach(id => {
          if (new Date(threads[id].updated || threads[id].created) < dayAgo) {
            delete threads[id];
          }
        });
        saveThreads(threads);
        
        res.end(JSON.stringify({
          answer,
          threadId: tid,
          sources: extractSources(answer, context),
          remaining: RATE_LIMIT - (rateLimits.get(ip)?.count || 0)
        }));
        
      } catch (e) {
        console.error('[ASK ERROR]', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to process question', detail: e.message }));
      }
    });
    return;
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Extract which data sources were used in the answer
function extractSources(answer, context) {
  const sources = [];
  const lower = answer.toLowerCase();
  
  if (lower.includes('btc') || lower.includes('bitcoin')) sources.push('BTC');
  if (lower.includes('eth') || lower.includes('ethereum')) sources.push('ETH');
  if (lower.includes('oil') || lower.includes('crude') || lower.includes('wti') || lower.includes('brent')) sources.push('Oil');
  if (lower.includes('gold')) sources.push('Gold');
  if (lower.includes('vix') || lower.includes('volatility')) sources.push('VIX');
  if (lower.includes('hormuz') || lower.includes('iran')) sources.push('Geopolitical');
  if (lower.includes('defense') || lower.includes('military')) sources.push('Defense');
  if (lower.includes('s&p') || lower.includes('spx') || lower.includes('stocks')) sources.push('Equities');
  
  return sources;
}

server.listen(PORT, () => {
  console.log(`[ASK-AI] Server running on port ${PORT}`);
  console.log(`[ASK-AI] Rate limit: ${RATE_LIMIT} questions/hour`);
});
