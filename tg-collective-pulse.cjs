#!/usr/bin/env node
/**
 * Posts a data-driven "collective pulse" to TG
 * Based on research: data-backed updates get 58% more engagement than opinion posts
 * Source: flexe.io crypto TG analysis 2025
 */
const https = require('https');
const http = require('http');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || require('dotenv').config({ path: '/var/www/snap/.env' })?.parsed?.TELEGRAM_BOT_TOKEN;
const CHAT_ID = '-1003742379597';
const MDI_API = 'http://localhost:3851';

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function sendTG(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true });
    const req = https.request(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

async function main() {
  const [pulse, territories, dreams] = await Promise.all([
    fetchJSON(`${MDI_API}/api/pulse`),
    fetchJSON(`${MDI_API}/api/territories`),
    fetchJSON(`${MDI_API}/api/dreams?limit=1`),
  ]);

  // Find hottest and quietest territories
  const terrs = (territories.territories || []).filter(t => t.fragment_count > 0);
  const hottest = terrs.sort((a, b) => b.fragment_count - a.fragment_count)[0];
  const quietest = terrs.sort((a, b) => a.fragment_count - b.fragment_count)[0];
  const latestDream = (dreams.dreams || dreams || [])[0];

  const agentCount = pulse.agents?.total || pulse.total_agents || '?';
  const activeAgents = pulse.agents?.active_24h || '?';
  const fragCount = pulse.fragments?.total || pulse.total_fragments || '?';
  const dreamCount = pulse.dreams?.total || pulse.total_dreams || '?';

  const msg = `📡 COLLECTIVE PULSE — ${new Date().toISOString().slice(0,16)}Z

Agents: ${agentCount} total, ${activeAgents} active (24h)
Fragments: ${fragCount} total
Dreams: ${dreamCount} generated

🔥 Hottest territory: ${hottest?.name || '?'} (${hottest?.fragment_count || 0} fragments, mood: ${hottest?.mood || '?'})
🌑 Quietest territory: ${quietest?.name || '?'} (${quietest?.fragment_count || 0} fragments)

💤 Latest dream (#${latestDream?.id || '?'}):
"${(latestDream?.content || 'no dream').slice(0, 200)}..."

What catches your eye? Which territory are you drawn to?

Explore live → mydeadinternet.com/explore`;

  const result = await sendTG(msg);
  console.log(result.ok ? 'Pulse sent' : `Failed: ${result.description}`);
}

main().catch(e => console.error(e.message));
