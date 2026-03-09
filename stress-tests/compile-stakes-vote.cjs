#!/usr/bin/env node
/**
 * compile-stakes-vote.cjs
 * Best-effort parse of TG stakes vote replies (A/B/C) from /var/www/snap/tg-bot.log.
 * Writes /var/www/snap/stress-tests/stakes-vote-scoreboard.md
 */

const fs = require('fs');
const path = require('path');

const LOG_PATH = process.env.TG_LOG_PATH || path.join(__dirname, '..', 'tg-bot.log');
const OUT_PATH = process.env.OUT_PATH || path.join(__dirname, 'stakes-vote-scoreboard.md');
const MAX_BYTES = Number(process.env.MAX_BYTES || 2_000_000);

function tailFileBytes(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

function extractVotes(text) {
  const lines = text.split(/\r?\n/);
  const votes = [];
  for (const line of lines) {
    if (!line.includes('SNAP →')) continue;
    const msg = line.slice(line.indexOf('SNAP →') + 'SNAP →'.length).trim();
    // Vote is a single letter A/B/C possibly with punctuation/whitespace
    const m = msg.match(/^([ABC])\b/i);
    if (!m) continue;
    votes.push({ vote: m[1].toUpperCase(), raw: msg });
  }
  return votes;
}

function main() {
  if (!fs.existsSync(LOG_PATH)) {
    console.error(`Log not found: ${LOG_PATH}`);
    process.exit(1);
  }

  const tail = tailFileBytes(LOG_PATH, MAX_BYTES);
  const votes = extractVotes(tail);

  const counts = { A: 0, B: 0, C: 0 };
  for (const v of votes) counts[v.vote]++;
  const total = votes.length;

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const md = [];
  md.push('# Stakes Vote — Tally (auto-compiled)');
  md.push('');
  md.push(`Last compiled: **${now}**`);
  md.push('');
  md.push(`Total votes found in log: **${total}**`);
  md.push('');
  md.push('## Options');
  md.push(`- A) Archive only never-posted — **${counts.A}**`);
  md.push(`- B) Archive never-posted + 7d dormant — **${counts.B}**`);
  md.push(`- C) No archive, just scoreboards — **${counts.C}**`);
  md.push('');
  md.push('---');
  md.push('Note: this reads tg-bot.log, so it may miss votes if logging format changes.');

  fs.writeFileSync(OUT_PATH, md.join('\n') + '\n');
  console.log(JSON.stringify({ ok: true, out: OUT_PATH, total, counts }, null, 2));
}

main();
