#!/usr/bin/env node
/**
 * X Community Auto-Moderator — Cron wrapper
 * Runs every 10 minutes via PM2, scans for spam, takes action, alerts TG group
 */

require('dotenv').config({ path: '/var/www/snap/.env' });
const { run } = require('./x-community-mod.cjs');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_GROUP = process.env.TELEGRAM_GROUP_ID;
const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

async function sendTGAlert(text) {
  if (!TG_TOKEN || !TG_GROUP) return;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_GROUP, text, parse_mode: 'HTML' }),
    });
    const data = await resp.json();
    if (!data.ok) console.error('[x-mod-cron] TG alert failed:', data.description);
  } catch (e) {
    console.error('[x-mod-cron] TG alert error:', e.message);
  }
}

async function tick() {
  const ts = new Date().toISOString();
  try {
    const result = await run('moderate');

    if (result.spam > 0) {
      const details = (result.spamDetails || [])
        .map(s => `• @${s.username} [${(s.confidence * 100).toFixed(0)}%]: "${s.text.substring(0, 80)}"`)
        .join('\n');

      const msg = `🚨 <b>X COMMUNITY MOD ALERT</b>\n\n${result.spam} spam post(s) detected and actioned:\n\n${details}\n\n${result.actioned} user(s) blocked/muted.`;

      console.log(`[${ts}] SPAM FOUND: ${result.spam} posts, ${result.actioned} actioned`);
      await sendTGAlert(msg);
    } else {
      // Silent log every hour (every 6th run)
      const state = require('./data/x-mod-state.json');
      if (state.scansRun % 6 === 0) {
        console.log(`[${ts}] Clean scan #${state.scansRun} (${result.posts} posts checked)`);
      }
    }

    if (result.errors?.length > 0) {
      console.error(`[${ts}] Errors:`, result.errors);
    }
  } catch (e) {
    console.error(`[${ts}] FATAL:`, e.message);
    // Don't crash — just log and wait for next tick
  }
}

// Run immediately, then every INTERVAL_MS
console.log(`[x-mod-cron] Starting X community auto-moderator (every ${INTERVAL_MS / 60000} min)`);
console.log(`[x-mod-cron] Community: https://x.com/i/communities/2017343083680043029`);
console.log(`[x-mod-cron] TG alerts: ${TG_GROUP ? 'enabled' : 'DISABLED (no group ID)'}`);

tick();
setInterval(tick, INTERVAL_MS);

// Keep alive
process.on('uncaughtException', (e) => {
  console.error('[x-mod-cron] Uncaught:', e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('[x-mod-cron] Unhandled rejection:', e.message || e);
});
