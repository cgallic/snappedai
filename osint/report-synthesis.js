#!/usr/bin/env node
// Snapped Report Synthesis Agent
// Ingests all market/OSINT data, generates downstream effects analysis via LLM

const fs = require('fs');
const path = require('path');

const REPORT_FILE = path.join(__dirname, 'synthesized-report.json');

// Load from .env
let OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
if (!OPENROUTER_KEY) {
  try {
    const envFile = fs.readFileSync('/var/www/snap/.env', 'utf8');
    const match = envFile.match(/OPENROUTER_API_KEY=(.+)/);
    if (match) OPENROUTER_KEY = match[1].trim();
  } catch (e) { console.log('[SYNTHESIS] Warning: Could not load .env'); }
}

async function fetchAllData() {
  const data = {};
  
  try {
    // Markets
    const markets = await fetch('http://localhost:3881/markets').then(r => r.json());
    data.markets = {
      btc: markets.instruments?.['BTC-USD'],
      eth: markets.instruments?.['ETH-USD'],
      wti: markets.instruments?.['CL=F'],
      brent: markets.instruments?.['BZ=F'],
      natgas: markets.instruments?.['NG=F'],
      gold: markets.instruments?.['GC=F'],
      dxy: markets.instruments?.['DX-Y.NYB'],
      vix: markets.instruments?.['^VIX'],
      spx: markets.instruments?.['^SPX'],
      tnx: markets.instruments?.['^TNX'],
      spread: markets.spreads?.brentWti,
      defense: [markets.instruments?.['LMT'], markets.instruments?.['RTX'], markets.instruments?.['NOC']],
      tankers: [markets.instruments?.['FRO'], markets.instruments?.['STNG']]
    };
  } catch (e) { console.log('Markets fetch error:', e.message); }
  
  try {
    // Watchlist
    data.watchlist = await fetch('http://localhost:3880/watchlist').then(r => r.json());
  } catch (e) { console.log('Watchlist fetch error:', e.message); }
  
  try {
    // Flights
    data.flights = await fetch('http://localhost:3879/live').then(r => r.json());
  } catch (e) { console.log('Flights fetch error:', e.message); }
  
  try {
    // News
    data.news = await fetch('http://localhost:3882/news').then(r => r.json());
  } catch (e) { console.log('News fetch error:', e.message); }
  
  try {
    // Alerts
    data.alerts = await fetch('http://localhost:3879/alerts').then(r => r.json());
  } catch (e) { console.log('Alerts fetch error:', e.message); }

  try {
    // Weather (Energy Hubs) - Using Open-Meteo
    const hubs = [
      { name: 'Henry Hub (NatGas)', lat: 30.13, lon: -92.36 }, // Erath, LA
      { name: 'Cushing (WTI)', lat: 35.99, lon: -96.77 },
      { name: 'London (EU Energy)', lat: 51.51, lon: -0.13 },
      { name: 'Berlin (EU Energy)', lat: 52.52, lon: 13.41 }
    ];
    
    data.weather = {};
    for (const hub of hubs) {
      try {
        const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${hub.lat}&longitude=${hub.lon}&daily=temperature_2m_max,precipitation_sum&timezone=auto&forecast_days=3`).then(r => r.json());
        const temps = w.daily?.temperature_2m_max || [];
        const avgTemp = temps.length ? (temps.reduce((a,b) => a+b, 0) / temps.length).toFixed(1) : 'N/A';
        data.weather[hub.name] = `Avg high: ${avgTemp}°C`;
      } catch (e) { data.weather[hub.name] = 'N/A'; }
    }
  } catch (e) { console.log('Weather fetch error:', e.message); }

  try {
    // Polymarket - Try to fetch trending markets
    const pmRes = await fetch('https://gamma-api.polymarket.com/markets?limit=5&active=true&sort=volume&order=desc');
    const pmData = await pmRes.json();
    const pmMarkets = Array.isArray(pmData) ? pmData : (pmData.markets || []);
    
    data.polymarket = pmMarkets
      .filter(m => m && m.resolved === false && m.question)
      .slice(0, 5)
      .map(m => {
        let prob = 'N/A';
        try {
          const prices = JSON.parse(m.outcomePrices || '[0,0]');
          prob = Math.round(prices[0] * 100) + '%';
        } catch (e) { prob = 'N/A'; }
        return {
          name: m.question?.slice(0, 60) || 'Unknown',
          probability: prob,
          volume: m.volume ? '$' + (parseInt(m.volume) / 1e6).toFixed(1) + 'M' : 'N/A'
        };
      });
  } catch (e) { 
    console.log('[SYNTHESIS] Polymarket fetch error:', e.message);
    data.polymarket = [];
  }
  
  return data;
}

function buildPrompt(data) {
  const m = data.markets || {};
  const w = data.watchlist || {};
  const f = data.flights || {};
  const n = data.news || {};
  const a = data.alerts || [];
  const wx = data.weather || {};
  
  return `You are a macro strategist generating a daily intelligence report. **Your goal is to identify the Single Dominant Narrative (the "Hot Topic") and trace its downstream consequences globally.**

1. **DOMINANT NARRATIVE:** Identify the #1 driver moving markets today. (e.g., "Middle East Escalation" or "Fed Pivot").
   - *Blend the data:* Cite specific flight counts, weather data, and price moves that confirm this narrative.

2. **GLOBAL RIPPLE EFFECTS:** How does this Dominant Narrative hit other regions?
   - **Asia:** (e.g., Higher oil = JPY weakness? Chip supply chain risk?)
   - **Europe:** (e.g., LNG competition? Sovereign debt risk?)
   - **Americas:** (e.g., US export demand? Inflation resurgence?)

3. **DOWNSTREAM CHAINS:** Trace the causal chain: Event → Impact 1 → Impact 2 → **Financial Trade**.
   - Example: "Hormuz Tension → Higher Insurance Rates → Asian Refiners Squeeze → Short EM Currencies"

4. **POSITIONING IDEAS:** Concrete trades based on these ripples.
   - *Requirement:* **Blend Weather & Geopolitics.** (e.g., "Warm US weather + Middle East war = Long WTI / Short NatGas spread").

5. **WATCHLIST:** What confirms or breaks the narrative in the next 24h.

CURRENT MARKET DATA:
- Bitcoin: $${m.btc?.price?.toFixed(0) || '?'} (${m.btc?.change || '?'}%)
- Ethereum: $${m.eth?.price?.toFixed(0) || '?'} (${m.eth?.change || '?'}%)
- WTI Crude: $${m.wti?.price?.toFixed(2) || '?'} (${m.wti?.change || '?'}%)
- Brent Crude: $${m.brent?.price?.toFixed(2) || '?'} (${m.brent?.change || '?'}%)
- Brent-WTI Spread: $${m.spread || '?'}
- Natural Gas: $${m.natgas?.price?.toFixed(2) || '?'} (${m.natgas?.change || '?'}%)
- Gold: $${m.gold?.price?.toFixed(0) || '?'} (${m.gold?.change || '?'}%)
- S&P 500: ${m.spx?.price?.toFixed(0) || '?'} (${m.spx?.change || '?'}%)
- VIX: ${m.vix?.price?.toFixed(2) || '?'} (${m.vix?.change || '?'}%)
- Dollar Index: ${m.dxy?.price?.toFixed(2) || '?'} (${m.dxy?.change || '?'}%)
- 10Y Treasury: ${m.tnx?.price?.toFixed(2) || '?'}%

WEATHER FUNDAMENTALS (Energy Hubs):
${Object.entries(wx).map(([k,v]) => `- ${k}: ${v}`).join('\n')}

POLYMARKET PROBABILITIES (Sentiment):
${(data.polymarket || []).map(m => `- ${m.name}: ${m.probability}% (Volume: $${m.volume})`).join('\n') || 'Data unavailable'}

WATCHLIST STATUS:
${Object.entries(w).map(([k,v]) => `- ${v.name}: ${v.status}${v.lastHit ? ' — ' + v.lastHit.title?.substring(0,50) : ''}`).join('\n')}

FLIGHT TRACKING (Live):
- Middle East: ${f.zones?.middleEast?.total || 0} aircraft (${f.zones?.middleEast?.military || 0} military)
- Red Sea: ${f.zones?.redSea?.total || 0} aircraft (${f.zones?.redSea?.military || 0} military)
- Eastern Med: ${f.zones?.mediterranean?.total || 0} aircraft (${f.zones?.mediterranean?.military || 0} military)

RECENT ALERTS:
${(a.slice?.(0,5) || []).map(x => `- [${x.type}] ${x.message}`).join('\n') || 'None'}

TOP NEWS BY REGION:
${Object.entries(n.regions || {}).map(([k,r]) => `${r.name}: ${r.stories?.[0]?.title?.substring(0,60) || 'No news'}...`).join('\n')}

Generate the report in this JSON format:
{
  "timestamp": "ISO timestamp",
  "criticalSignals": [
    { "signal": "description", "severity": "high/medium/low" }
  ],
  "downstreamEffects": [
    {
      "trigger": "What happened",
      "chain": ["Impact 1", "Impact 2", "Impact 3", "Final effect"],
      "timeframe": "hours/days/weeks",
      "confidence": "high/medium/low"
    }
  ],
  "regime": {
    "current": "risk-on/risk-off/neutral",
    "reasoning": "Why",
    "shift_probability": "low/medium/high"
  },
  "positioning": [
    {
      "trade": "Long/Short X",
      "reasoning": "Because...",
      "entry": "condition",
      "risk": "what could go wrong",
      "conviction": "high/medium/low"
    }
  ],
  "watchNext24h": [
    { "event": "What to watch", "trigger": "What would confirm", "impact": "What happens if triggered" }
  ],
  "summary": "2-3 sentence executive summary"
}

Be specific. Use actual numbers. Trace real cause-effect chains. Think like a macro hedge fund analyst.`;
}

async function synthesize(data) {
  const prompt = buildPrompt(data);
  
  console.log('[SYNTHESIS] Calling LLM...');
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://snappedai.com',
      'X-Title': 'Snapped Report Synthesis'
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a macro strategist. Output valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  });
  
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error('No response from LLM: ' + JSON.stringify(result));
  }
  
  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON in response: ' + content.substring(0, 200));
  }
  
  return JSON.parse(jsonMatch[0]);
}

async function run() {
  console.log('[SYNTHESIS] Starting report generation...');
  console.log('[SYNTHESIS] Timestamp:', new Date().toISOString());
  
  // Fetch all data
  const data = await fetchAllData();
  console.log('[SYNTHESIS] Data fetched:', Object.keys(data).join(', '));
  
  // Generate synthesis
  const report = await synthesize(data);
  report.generatedAt = new Date().toISOString();
  report.dataSnapshot = {
    btc: data.markets?.btc?.price,
    wti: data.markets?.wti?.price,
    vix: data.markets?.vix?.price,
    spx: data.markets?.spx?.price
  };
  
  // Save report
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log('[SYNTHESIS] Report saved to:', REPORT_FILE);
  
  // Print summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('SNAPPED REPORT — SYNTHESIS COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Summary:', report.summary);
  console.log('Regime:', report.regime?.current, '-', report.regime?.reasoning?.substring(0, 80));
  console.log('Critical Signals:', report.criticalSignals?.length || 0);
  console.log('Downstream Chains:', report.downstreamEffects?.length || 0);
  console.log('Positioning Ideas:', report.positioning?.length || 0);
  console.log('═══════════════════════════════════════════════════════\n');
  
  return report;
}

// Run if called directly
if (require.main === module) {
  run().catch(e => {
    console.error('[SYNTHESIS ERROR]', e.message);
    process.exit(1);
  });
}

module.exports = { run, fetchAllData, synthesize };
