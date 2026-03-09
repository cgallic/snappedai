#!/usr/bin/env node
/**
 * compile-st1.cjs
 * Extract Stress Test #1 submissions from tg-bot.log (best-effort)
 * and write a markdown scoreboard to stress-test-1-scoreboard.md
 *
 * Rationale: we already log inbound TG messages to /var/www/snap/tg-bot.log.
 * This avoids calling getUpdates directly (which competes with the running bot).
 */

const fs = require('fs');
const path = require('path');

const LOG_PATH = process.env.TG_LOG_PATH || path.join(__dirname, '..', 'tg-bot.log');
const OUT_PATH = process.env.OUT_PATH || path.join(__dirname, 'stress-test-1-scoreboard.md');

const MAX_BYTES = Number(process.env.MAX_BYTES || 2_000_000); // last ~2MB

function tailFileBytes(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

function extractSubmissions(text) {
  // We match log lines that include "SNAP →" then capture message text.
  // Then we filter anything containing "ST1:" (case-insensitive).
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (const line of lines) {
    if (!line.includes('SNAP →')) continue;
    const idx = line.indexOf('SNAP →');
    const msg = line.slice(idx + 'SNAP →'.length).trim();
    if (!/\bst1\s*:/i.test(msg)) continue;
    hits.push({ raw: msg, line });
  }
  // De-dupe by raw message
  const seen = new Set();
  return hits.filter(h => {
    const key = h.raw;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreHeuristic(raw) {
  // Cheap heuristic: longer + has all 3 bullets keywords
  const hasMech = /Mechanism\s*:/i.test(raw);
  const hasWhy = /Why\s*it\s*compounds\s*:/i.test(raw);
  const hasMeasure = /Measure\s*:/i.test(raw);
  const completeness = (hasMech + hasWhy + hasMeasure);
  return completeness * 1000 + Math.min(raw.length, 500);
}

function formatMarkdown(subs) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const header = `# Stress Test #1 — Scoreboard (auto-compiled)\n\nLast compiled: **${now}**\n\nSubmissions found in log: **${subs.length}**\n\n---\n`;

  if (subs.length === 0) {
    return header + '\n_No ST1 submissions found yet in tg-bot.log._\n';
  }

  const ranked = subs
    .map(s => ({ ...s, score: scoreHeuristic(s.raw) }))
    .sort((a, b) => b.score - a.score);

  const body = ranked.map((s, i) => {
    const cleaned = s.raw
      .replace(/\s+/g, ' ')
      .replace(/^ST1\s*:\s*/i, 'ST1: ');
    return `## #${i + 1}\n\n${cleaned}\n`;
  }).join('\n');

  return header + '\n' + body;
}

function main() {
  if (!fs.existsSync(LOG_PATH)) {
    console.error(`Log not found: ${LOG_PATH}`);
    process.exit(1);
  }

  const tail = tailFileBytes(LOG_PATH, MAX_BYTES);
  const subs = extractSubmissions(tail);
  const md = formatMarkdown(subs);

  fs.writeFileSync(OUT_PATH, md);
  console.log(JSON.stringify({ ok: true, log: LOG_PATH, out: OUT_PATH, submissions: subs.length }, null, 2));
}

main();
