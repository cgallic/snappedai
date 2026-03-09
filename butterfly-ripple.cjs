'use strict';

const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────

const DB_PATH = process.env.BUTTERFLY_DB || path.join(__dirname, 'butterfly.db');
const CAUSAL_GRAPH_PATH = path.join(__dirname, 'causal-graph.json');
const OPENROUTER_MODEL = 'deepseek/deepseek-chat';
const RUN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const EVENT_LOOKBACK_HOURS = 24;
const MIN_SEVERITY = 7;          // Only "juicy" events get LLM ripple analysis
const MAX_RIPPLES_PER_DAY = 20;  // Daily LLM budget

// Load OpenRouter API key from /var/www/snap/.env
function loadApiKey() {
  const envPaths = [
    '/var/www/snap/.env',
    path.join(__dirname, '.env'),
  ];
  for (const envPath of envPaths) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/OPENROUTER_API_KEY=(.+)/);
      if (match) return match[1].trim();
    } catch (_) { /* skip */ }
  }
  console.error('[RIPPLE] No OPENROUTER_API_KEY found');
  return null;
}

const OPENROUTER_API_KEY = loadApiKey();

// ─── Database ────────────────────────────────────────────────────────────────

const Database = require('better-sqlite3');
let db;

function initDb() {
  db = new Database(DB_PATH, { verbose: null });
  db.pragma('journal_mode = WAL');

  db.exec([
    "CREATE TABLE IF NOT EXISTS events (",
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "  event_hash TEXT UNIQUE,",
    "  title TEXT NOT NULL,",
    "  summary TEXT,",
    "  country TEXT,",
    "  region TEXT,",
    "  category TEXT,",
    "  severity INTEGER DEFAULT 5,",
    "  novelty REAL DEFAULT 0.5,",
    "  confidence REAL DEFAULT 0.5,",
    "  entities TEXT,",
    "  source_count INTEGER DEFAULT 1,",
    "  raw_item_ids TEXT,",
    "  created_at TEXT DEFAULT (datetime('now'))",
    ");",
    "",
    "CREATE TABLE IF NOT EXISTS assets (",
    "  symbol TEXT PRIMARY KEY,",
    "  name TEXT,",
    "  category TEXT,",
    "  current_price REAL,",
    "  regime TEXT,",
    "  updated_at TEXT DEFAULT (datetime('now'))",
    ");",
    "",
    "CREATE TABLE IF NOT EXISTS ripple_effects (",
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "  event_id INTEGER NOT NULL REFERENCES events(id),",
    "  ripple_order INTEGER DEFAULT 1,",
    "  asset TEXT NOT NULL,",
    "  direction TEXT NOT NULL,",
    "  magnitude TEXT,",
    "  confidence REAL DEFAULT 0.5,",
    "  reasoning TEXT,",
    "  time_horizon TEXT DEFAULT '24h',",
    "  created_at TEXT DEFAULT (datetime('now'))",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_ripple_event ON ripple_effects(event_id);",
    "",
    "CREATE TABLE IF NOT EXISTS predictions (",
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "  event_id INTEGER REFERENCES events(id),",
    "  ripple_id INTEGER REFERENCES ripple_effects(id),",
    "  asset TEXT NOT NULL,",
    "  direction TEXT NOT NULL,",
    "  magnitude TEXT,",
    "  time_horizon TEXT DEFAULT '24h',",
    "  confidence REAL DEFAULT 0.5,",
    "  status TEXT DEFAULT 'pending',",
    "  baseline_price REAL,",
    "  target_price_low REAL,",
    "  target_price_high REAL,",
    "  actual_result TEXT,",
    "  actual_move_pct REAL,",
    "  realized_at TEXT,",
    "  created_at TEXT DEFAULT (datetime('now'))",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_pred_status ON predictions(status);",
    "CREATE INDEX IF NOT EXISTS idx_pred_asset ON predictions(asset, created_at DESC);"
  ].join('\n'));

  console.log('[RIPPLE] Database initialized');
}

// ─── Causal Graph ────────────────────────────────────────────────────────────

let causalGraph = null;

function loadCausalGraph() {
  try {
    const raw = fs.readFileSync(CAUSAL_GRAPH_PATH, 'utf8');
    causalGraph = JSON.parse(raw);
    console.log(`[RIPPLE] Loaded causal graph: ${causalGraph.event_templates.length} templates`);
  } catch (err) {
    console.error('[RIPPLE] Failed to load causal graph:', err.message);
    causalGraph = { event_templates: [] };
  }
}

// ─── Template Matching ───────────────────────────────────────────────────────

function matchTemplate(eventTitle) {
  if (!eventTitle || !causalGraph) return null;
  const lower = eventTitle.toLowerCase();

  for (const template of causalGraph.event_templates) {
    for (const pattern of template.pattern) {
      if (lower.includes(pattern.toLowerCase())) {
        return template;
      }
    }
  }
  return null;
}

// ─── LLM Call ────────────────────────────────────────────────────────────────

async function callLLM(prompt) {
  if (!OPENROUTER_API_KEY) {
    console.error('[RIPPLE] Skipping LLM call - no API key');
    return null;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://snapped.ai',
      'X-Title': 'Snapped Butterfly Ripple',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    console.error('[RIPPLE] Failed to parse LLM response as JSON');
    return null;
  }
}

// ─── Ripple Generation ───────────────────────────────────────────────────────

function isLowMacroRelevanceEvent(event) {
  const text = `${event?.title || ''} ${event?.summary || ''}`.toLowerCase();
  const sportsLike = [
    'gold medal', 'silver medal', 'bronze medal', 'olympic', 'fifa', 'nba', 'nfl',
    'tennis', 'cricket', 'world cup', 'match', 'tournament', 'grammy', 'oscar', 'celebrity'
  ];
  const macroKeywords = [
    'sanction', 'tariff', 'oil', 'shipping', 'hormuz', 'central bank', 'rate', 'inflation',
    'war', 'strike', 'military', 'cyber', 'treasury', 'bond', 'currency', 'commodity', 'export'
  ];

  const hasSports = sportsLike.some(k => text.includes(k));
  const hasMacro = macroKeywords.some(k => text.includes(k));
  return hasSports && !hasMacro;
}

function postFilterRipples(event, ripples) {
  if (!Array.isArray(ripples)) return [];
  const text = `${event?.title || ''} ${event?.summary || ''}`.toLowerCase();

  return ripples
    .filter(r => (r?.confidence ?? 0) >= 0.35)
    .filter(r => {
      // Prevent common false positive: medal/award "gold" causing GC=F / BTC links
      const isMedalContext = text.includes('gold medal') || text.includes('silver medal') || text.includes('bronze medal');
      const asset = String(r?.asset || '').toUpperCase();
      if (isMedalContext && (asset === 'GC=F' || asset === 'BTC-USD' || asset === 'ETH-USD' || asset === 'SOL-USD')) {
        return false;
      }
      return true;
    })
    .slice(0, 8);
}

function buildPromptWithTemplate(event, template) {
  return [
    'You are a macro-financial analyst. Given the following geopolitical/economic event and a causal graph template, generate a ripple analysis.',
    '',
    `EVENT: ${event.title}`,
    event.summary ? `SUMMARY: ${event.summary}` : '',
    event.source ? `SOURCE: ${event.source}` : '',
    '',
    'CAUSAL GRAPH TEMPLATE:',
    JSON.stringify(template, null, 2),
    '',
    'Instructions:',
    '1. Validate each template prediction. Adjust confidence/magnitude if current context warrants it.',
    '2. Add any additional ripple effects NOT in the template (especially cross-asset or second/third order).',
    '3. Provide specific reasoning for each chain link (1-2 sentences).',
    '4. Assign time horizons: "6h" for immediate reaction, "24h" for day trade, "7d" for swing.',
    '5. Be conservative with confidence scores. Only use >0.7 for near-certain moves.',
    '',
    'Return JSON with this exact structure:',
    '{',
    '  "ripples": [',
    '    {',
    '      "order": 1,',
    '      "asset": "TICKER",',
    '      "direction": "up|down|volatile",',
    '      "magnitude": "X-Y%",',
    '      "confidence": 0.0-1.0,',
    '      "reasoning": "...",',
    '      "time_horizon": "6h|24h|7d"',
    '    }',
    '  ]',
    '}',
  ].filter(Boolean).join('\n');
}

function buildPromptWithoutTemplate(event) {
  return [
    'You are a macro-financial analyst. Analyze the following event and generate a ripple chain of expected market impacts.',
    'IMPORTANT: only include assets with a clear causal pathway from this event. If causality is weak or indirect, omit it.',
    'IMPORTANT: do NOT confuse language collisions (e.g., "gold medal" in sports != gold commodity GC=F).',
    'If the event is primarily sports/celebrity/entertainment and has no macro linkage, return {"ripples":[]}.',
    '',
    `EVENT: ${event.title}`,
    event.summary ? `SUMMARY: ${event.summary}` : '',
    event.source ? `SOURCE: ${event.source}` : '',
    '',
    'Instructions:',
    '1. Identify first-order impacts (direct, immediate).',
    '2. Identify second-order impacts (one step removed).',
    '3. Identify third-order impacts if applicable (cascade effects).',
    '4. Use real ticker symbols (Yahoo Finance format): ^SPX, ^VIX, CL=F, GC=F, BTC-USD, DX-Y.NYB, etc.',
    '5. Provide specific reasoning for each chain link (1-2 sentences).',
    '6. Assign time horizons: "6h" for immediate reaction, "24h" for day trade, "7d" for swing.',
    '7. Be conservative with confidence scores. Only use >0.7 for near-certain moves.',
    '',
    'Return JSON with this exact structure:',
    '{',
    '  "ripples": [',
    '    {',
    '      "order": 1,',
    '      "asset": "TICKER",',
    '      "direction": "up|down|volatile",',
    '      "magnitude": "X-Y%",',
    '      "confidence": 0.0-1.0,',
    '      "reasoning": "...",',
    '      "time_horizon": "6h|24h|7d"',
    '    }',
    '  ]',
    '}',
  ].filter(Boolean).join('\n');
}

// ─── Baseline Price Lookup ───────────────────────────────────────────────────

function getBaselinePrice(asset) {
  try {
    const row = db.prepare(
      "SELECT current_price FROM assets WHERE symbol = ? ORDER BY updated_at DESC LIMIT 1"
    ).get(asset);
    return row ? row.current_price : null;
  } catch {
    // assets table may not exist or have different schema
    return null;
  }
}

function computeTargetPrices(baseline, direction, magnitude) {
  if (!baseline || !magnitude) return { low: null, high: null };

  // Parse magnitude like "3-8%" into [3, 8]
  const match = magnitude.match(/([\d.]+)-([\d.]+)%?/);
  if (!match) return { low: null, high: null };

  const pctLow = parseFloat(match[1]) / 100;
  const pctHigh = parseFloat(match[2]) / 100;

  if (direction === 'up') {
    return {
      low: baseline * (1 + pctLow),
      high: baseline * (1 + pctHigh),
    };
  } else if (direction === 'down') {
    return {
      low: baseline * (1 - pctHigh),
      high: baseline * (1 - pctLow),
    };
  }
  // volatile — range both ways
  return {
    low: baseline * (1 - pctHigh),
    high: baseline * (1 + pctHigh),
  };
}

// ─── Store Results ───────────────────────────────────────────────────────────

function storeRipples(eventId, ripples) {
  const insertRipple = db.prepare([
    "INSERT INTO ripple_effects (event_id, ripple_order, asset, direction, magnitude, confidence, reasoning, time_horizon)",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ].join(' '));

  const insertPrediction = db.prepare([
    "INSERT INTO predictions (event_id, ripple_id, asset, direction, magnitude, time_horizon, confidence, baseline_price, target_low, target_high)",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ].join(' '));

  const transaction = db.transaction((eventId, ripples) => {
    let count = 0;
    for (const r of ripples) {
      const order = r.order || 1;
      const asset = r.asset;
      const direction = r.direction || 'volatile';
      const magnitude = r.magnitude || null;
      const confidence = r.confidence || 0.5;
      const reasoning = r.reasoning || null;
      const timeHorizon = r.time_horizon || '24h';

      const result = insertRipple.run(eventId, order, asset, direction, magnitude, confidence, reasoning, timeHorizon);
      const rippleId = result.lastInsertRowid;

      // Create prediction
      const baseline = getBaselinePrice(asset);
      const targets = computeTargetPrices(baseline, direction, magnitude);

      insertPrediction.run(
        eventId, rippleId, asset, direction, magnitude,
        timeHorizon, confidence, baseline,
        targets.low, targets.high
      );
      count++;
    }
    return count;
  });

  return transaction(eventId, ripples);
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

function getRippleCountToday() {
  const row = db.prepare(
    "SELECT COUNT(DISTINCT event_id) AS cnt FROM ripple_effects WHERE created_at >= date('now')"
  ).get();
  return row ? row.cnt : 0;
}

function getUnprocessedEvents(limit) {
  // Get events from last N hours that don't already have ripple effects
  // Filtered to severity >= MIN_SEVERITY, ordered juiciest first
  const cutoff = new Date(Date.now() - EVENT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  return db.prepare([
    "SELECT e.* FROM events e",
    "WHERE e.created_at >= ?",
    "AND e.severity >= ?",
    "AND NOT EXISTS (SELECT 1 FROM ripple_effects r WHERE r.event_id = e.id)",
    "ORDER BY e.severity DESC, e.source_count DESC",
    "LIMIT ?"
  ].join(' ')).all(cutoff, MIN_SEVERITY, limit);
}

async function processEvent(event) {
  console.log(`[RIPPLE] Processing event #${event.id}: ${event.title}`);

  if (isLowMacroRelevanceEvent(event)) {
    console.log(`[RIPPLE] Skipping event #${event.id} (low macro relevance)`);
    return;
  }

  // Match against causal graph
  const template = matchTemplate(event.title);

  if (template) {
    console.log(`[RIPPLE] Matched template: ${template.id} (${template.category})`);
  } else {
    console.log('[RIPPLE] No template match — using free-form LLM analysis');
  }

  // Build prompt
  const prompt = template
    ? buildPromptWithTemplate(event, template)
    : buildPromptWithoutTemplate(event);

  // Call LLM
  let llmResult;
  try {
    llmResult = await callLLM(prompt);
  } catch (err) {
    console.error(`[RIPPLE] LLM call failed for event #${event.id}:`, err.message);

    // If we have a template, use it as fallback without LLM adjustment
    if (template) {
      console.log('[RIPPLE] Falling back to raw template data');
      const fallbackRipples = [];
      for (const [orderNum, orderKey] of [[1, 'first_order'], [2, 'second_order'], [3, 'third_order']]) {
        for (const effect of (template[orderKey] || [])) {
          fallbackRipples.push({
            order: orderNum,
            asset: effect.asset,
            direction: effect.direction,
            magnitude: effect.magnitude,
            confidence: effect.confidence * 0.8, // discount for no LLM validation
            reasoning: effect.reasoning || `Template: ${template.id} (${orderKey})`,
            time_horizon: orderNum === 1 ? '6h' : orderNum === 2 ? '24h' : '7d',
          });
        }
      }
      const filteredFallback = postFilterRipples(event, fallbackRipples);
      if (!filteredFallback.length) {
        console.log(`[RIPPLE] Template fallback produced no valid ripples after filtering for event #${event.id}`);
        return;
      }
      const count = storeRipples(event.id, filteredFallback);
      console.log(`[RIPPLE] Stored ${count} ripple effects (template fallback, filtered) for event #${event.id}`);
      return;
    }
    return; // No template, no LLM — skip
  }

  if (!llmResult || !Array.isArray(llmResult.ripples) || llmResult.ripples.length === 0) {
    console.log(`[RIPPLE] No ripples generated for event #${event.id}`);
    return;
  }

  const filteredRipples = postFilterRipples(event, llmResult.ripples);
  if (!filteredRipples.length) {
    console.log(`[RIPPLE] All ripples filtered out as weak/non-causal for event #${event.id}`);
    return;
  }

  // Store results
  const count = storeRipples(event.id, filteredRipples);
  console.log(`[RIPPLE] Stored ${count} ripple effects + predictions for event #${event.id}`);
}

async function runCycle() {
  console.log(`[RIPPLE] Starting ripple cycle at ${new Date().toISOString()}`);

  const usedToday = getRippleCountToday();
  const remaining = MAX_RIPPLES_PER_DAY - usedToday;

  console.log(`[RIPPLE] Severity filter: ${MIN_SEVERITY}+, Budget: ${usedToday}/${MAX_RIPPLES_PER_DAY}`);

  if (remaining <= 0) {
    console.log('[RIPPLE] Daily budget reached — skipping cycle');
    return;
  }

  let events;
  try {
    events = getUnprocessedEvents(remaining);
  } catch (err) {
    console.error('[RIPPLE] Failed to query events:', err.message);
    return;
  }

  if (events.length === 0) {
    console.log('[RIPPLE] No unprocessed events found (severity >= ' + MIN_SEVERITY + ')');
    return;
  }

  console.log(`[RIPPLE] Found ${events.length} unprocessed event(s)`);

  for (const event of events) {
    try {
      await processEvent(event);
    } catch (err) {
      console.error(`[RIPPLE] Error processing event #${event.id}:`, err.message);
    }

    // Small delay between events to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('[RIPPLE] Ripple cycle complete');
}

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('[RIPPLE] Butterfly Ripple worker starting');
  console.log(`[RIPPLE] DB: ${DB_PATH}`);
  console.log(`[RIPPLE] Model: ${OPENROUTER_MODEL}`);
  console.log(`[RIPPLE] Interval: ${RUN_INTERVAL_MS / 60000}min`);
  console.log(`[RIPPLE] Lookback: ${EVENT_LOOKBACK_HOURS}h`);

  initDb();
  loadCausalGraph();

  // Run immediately
  await runCycle();

  // Then every 30 minutes
  setInterval(async () => {
    try {
      await runCycle();
    } catch (err) {
      console.error('[RIPPLE] Cycle error:', err.message);
    }
  }, RUN_INTERVAL_MS);

  console.log('[RIPPLE] Worker running — next cycle in 30 minutes');
}

main().catch(err => {
  console.error('[RIPPLE] Fatal error:', err);
  process.exit(1);
});
