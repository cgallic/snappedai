#!/usr/bin/env node
/**
 * SNAP TG Sentiment Tracker — Evolution #3
 * Analyzes TG chat logs and tracks sentiment over time.
 * Usage: node sentiment-tracker.cjs [--hours=6] [--save]
 */
require('dotenv').config();
const fs = require('fs');

const LOG_PATH = '/root/.pm2/logs/snap-tg-out.log';
const STATE_PATH = '/var/www/snap/api/sentiment-state.json';

// Simple keyword-based sentiment scoring
const POSITIVE = ['lfg', 'bullish', 'moon', 'pump', 'nice', 'great', 'amazing', 'love', 'buy', 'hold', 'build', 'grow', 'good', 'yes', 'agreed', 'gm', 'lets go', 'diamond', 'strong', 'accept', 'welcome', 'fire', '🔥', '🚀', '💪', '❤️', '🙌', 'wow'];
const NEGATIVE = ['dump', 'rug', 'scam', 'dead', 'sell', 'bearish', 'crash', 'die', 'died', 'fake', 'bad', 'shit', 'hate', 'leave', 'rip', 'down', 'fear', 'worried', 'concern', 'fud'];
const NEUTRAL_PATTERNS = [/\/start/, /^gm$/, /^\d+$/, /^\.$/];

function parseLine(line) {
  const match = line.match(/\[([\d-T:.Z]+)\] (.+?) \(uid:(\d+)\): (.+)/);
  if (!match) return null;
  return { time: new Date(match[1]), user: match[2], uid: match[3], text: match[4] };
}

function scoreSentiment(text) {
  const lower = text.toLowerCase();
  let score = 0;
  
  for (const word of POSITIVE) {
    if (lower.includes(word)) score += 1;
  }
  for (const word of NEGATIVE) {
    if (lower.includes(word)) score -= 1;
  }
  
  // Normalize to -1 to 1
  return Math.max(-1, Math.min(1, score / 3));
}

function analyze(hoursBack = 6) {
  const logs = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = logs.split('\n');
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  
  const messages = [];
  const users = new Set();
  let totalScore = 0;
  let messageCount = 0;
  
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (parsed.time < cutoff) continue;
    
    users.add(parsed.uid);
    const sentiment = scoreSentiment(parsed.text);
    totalScore += sentiment;
    messageCount++;
    
    messages.push({
      time: parsed.time.toISOString(),
      user: parsed.user,
      text: parsed.text.substring(0, 100),
      sentiment
    });
  }
  
  const avgSentiment = messageCount > 0 ? totalScore / messageCount : 0;
  
  let mood;
  if (avgSentiment > 0.3) mood = '🟢 bullish';
  else if (avgSentiment > 0.1) mood = '🟡 cautiously optimistic';
  else if (avgSentiment > -0.1) mood = '⚪ neutral';
  else if (avgSentiment > -0.3) mood = '🟠 uncertain';
  else mood = '🔴 bearish';
  
  const topPositive = messages.filter(m => m.sentiment > 0).slice(-5);
  const topNegative = messages.filter(m => m.sentiment < 0).slice(-5);
  
  return {
    period: `${hoursBack}h`,
    timestamp: new Date().toISOString(),
    messageCount,
    uniqueUsers: users.size,
    avgSentiment: Math.round(avgSentiment * 1000) / 1000,
    mood,
    topPositive,
    topNegative,
    hourlyBreakdown: getHourlyBreakdown(messages)
  };
}

function getHourlyBreakdown(messages) {
  const hours = {};
  for (const msg of messages) {
    const hour = msg.time.substring(0, 13);
    if (!hours[hour]) hours[hour] = { count: 0, sentiment: 0 };
    hours[hour].count++;
    hours[hour].sentiment += msg.sentiment;
  }
  
  return Object.entries(hours).map(([hour, data]) => ({
    hour,
    messages: data.count,
    avgSentiment: Math.round((data.sentiment / data.count) * 1000) / 1000
  }));
}

// CLI
const args = process.argv.slice(2);
const hoursArg = args.find(a => a.startsWith('--hours='));
const hours = hoursArg ? parseInt(hoursArg.split('=')[1]) : 6;
const shouldSave = args.includes('--save');

const result = analyze(hours);

if (shouldSave) {
  // Load existing state and append
  let state = { history: [] };
  try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch {}
  state.history.push({ timestamp: result.timestamp, mood: result.mood, avgSentiment: result.avgSentiment, messages: result.messageCount, users: result.uniqueUsers });
  if (state.history.length > 100) state.history = state.history.slice(-100);
  state.latest = result;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log('Saved to', STATE_PATH);
}

console.log(JSON.stringify(result, null, 2));
