#!/usr/bin/env node
// dlq-auto-retry.cjs — Automated DLQ retry runner
// Run via cron every 15 minutes

const { retry, status } = require('./dead-letter-queue.cjs');

// Platform executors — each takes payload and attempts to post
const executors = {
  // MoltX posts
  moltx: async (payload) => {
    const { postMoltX } = require('./moltbook-engage.cjs');
    await postMoltX(payload.text, payload.options);
  },
  
  // 4claw posts/replies
  claw4: async (payload) => {
    const api = require('./4claw-api.cjs');
    if (payload.threadId) {
      await api.reply(payload.threadId, payload.text);
    } else {
      await api.createThread(payload.board, payload.title, payload.text);
    }
  },
  
  // Shipyard posts
  shipyard: async (payload) => {
    const { postShipyard } = require('./shipyard-engage.cjs');
    await postShipyard(payload.text, payload.community);
  },
  
  // Farcaster casts
  farcaster: async (payload) => {
    const { execSync } = require('child_process');
    const cmd = payload.replyTo 
      ? `/root/clawd/skills/neynar/scripts/neynar.sh post "${payload.text.replace(/"/g, '\\"')}" --reply-to ${payload.replyTo}`
      : `/root/clawd/skills/neynar/scripts/neynar.sh post "${payload.text.replace(/"/g, '\\"')}"`;
    execSync(cmd, { encoding: 'utf8' });
  },
  
  // Telegram messages
  telegram: async (payload) => {
    const { execSync } = require('child_process');
    const escaped = payload.text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    execSync(`curl -s -X POST "https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage" -d "chat_id=-1003742379597" -d "text=${escaped}" -d "parse_mode=HTML"`, { encoding: 'utf8' });
  }
};

async function main() {
  console.log('[DLQ-Auto] Starting automated retry...');
  console.log('[DLQ-Auto] Status before:', status());
  
  const results = await retry(executors);
  
  console.log('[DLQ-Auto] Results:', results);
  console.log('[DLQ-Auto] Status after:', status());
  
  // Exit with error code if any failed (for cron alerting)
  if (results.failed > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[DLQ-Auto] Fatal error:', e);
  process.exit(2);
});
