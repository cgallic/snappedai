/**
 * TG Message Logger — Persistent daily logs of all Telegram group messages
 * Stores to /var/www/snap/data/tg-logs/YYYY-MM-DD.jsonl (one JSON per line)
 * 
 * Usage in telegram-bot.cjs:
 *   const logger = require('./tg-logger.cjs');
 *   logger.logMessage(msg);       // log incoming user message
 *   logger.logBotReply(msg, reply); // log bot response
 *   logger.getDailyStats(date);   // get stats for a date
 *   logger.searchMessages(query, days); // search recent messages
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'data', 'tg-logs');

// Ensure directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile(date) {
  const d = date || new Date();
  const dateStr = d.toISOString().split('T')[0];
  return path.join(LOG_DIR, `${dateStr}.jsonl`);
}

function appendLog(entry) {
  try {
    const file = getLogFile(new Date(entry.timestamp));
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('Logger error:', e.message);
  }
}

/**
 * Log an incoming user message
 */
function logMessage(msg) {
  if (!msg) return;
  
  const entry = {
    type: 'user',
    timestamp: new Date(msg.date * 1000).toISOString(),
    message_id: msg.message_id,
    chat_id: msg.chat?.id,
    chat_title: msg.chat?.title,
    user_id: msg.from?.id,
    username: msg.from?.username || msg.from?.first_name || 'unknown',
    is_bot: msg.from?.is_bot || false,
    text: msg.text || msg.caption || '',
    media_type: msg.photo ? 'photo' : msg.video ? 'video' : msg.voice ? 'voice' : msg.document ? 'document' : msg.sticker ? 'sticker' : msg.animation ? 'gif' : null,
    reply_to_message_id: msg.reply_to_message?.message_id || null,
    reply_to_user: msg.reply_to_message?.from?.username || null,
    entities: (msg.entities || []).map(e => e.type),
  };
  
  appendLog(entry);
  return entry;
}

/**
 * Log a bot reply
 */
function logBotReply(originalMsg, replyText, metadata = {}) {
  const entry = {
    type: 'bot',
    timestamp: new Date().toISOString(),
    chat_id: originalMsg?.chat?.id,
    in_reply_to: originalMsg?.message_id,
    in_reply_to_user: originalMsg?.from?.username || originalMsg?.from?.first_name,
    text: replyText,
    ...metadata, // tokens_used, model, response_time_ms, etc.
  };
  
  appendLog(entry);
  return entry;
}

/**
 * Log a proactive bot message (not a reply)
 */
function logBotPost(chatId, text, metadata = {}) {
  const entry = {
    type: 'bot_post',
    timestamp: new Date().toISOString(),
    chat_id: chatId,
    text: text,
    ...metadata,
  };
  
  appendLog(entry);
  return entry;
}

/**
 * Get daily stats for a given date string (YYYY-MM-DD) or Date object
 */
function getDailyStats(dateInput) {
  const dateStr = typeof dateInput === 'string' ? dateInput : (dateInput || new Date()).toISOString().split('T')[0];
  const file = path.join(LOG_DIR, `${dateStr}.jsonl`);
  
  if (!fs.existsSync(file)) return { date: dateStr, messages: 0, users: 0, bot_replies: 0 };
  
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  
  const userMessages = entries.filter(e => e.type === 'user' && !e.is_bot);
  const botReplies = entries.filter(e => e.type === 'bot' || e.type === 'bot_post');
  const uniqueUsers = new Set(userMessages.map(e => e.user_id));
  const usernames = {};
  userMessages.forEach(e => { usernames[e.user_id] = e.username; });
  
  // Top talkers
  const talkCount = {};
  userMessages.forEach(e => { talkCount[e.username] = (talkCount[e.username] || 0) + 1; });
  const topTalkers = Object.entries(talkCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  
  // Common topics (simple word frequency, skip short/common words)
  const stopwords = new Set(['the','a','an','is','are','was','were','be','been','to','of','in','for','on','with','at','by','it','this','that','and','or','but','not','no','yes','i','you','he','she','we','they','my','your','his','her','its','our','their','do','does','did','will','would','can','could','should','have','has','had','what','how','who','where','when','why','which','if','so','just','very','too','also','up','out','about','like','all','some','any','more','than','then','them','those','these','from','into','been','being','here','there','now','get','got','go','make']);
  const wordCount = {};
  userMessages.forEach(e => {
    (e.text || '').toLowerCase().split(/\s+/).forEach(w => {
      w = w.replace(/[^a-z0-9$@#]/g, '');
      if (w.length > 2 && !stopwords.has(w)) wordCount[w] = (wordCount[w] || 0) + 1;
    });
  });
  const topWords = Object.entries(wordCount).sort((a, b) => b[1] - a[1]).slice(0, 20);
  
  // Questions asked (messages ending with ?)
  const questions = userMessages.filter(e => (e.text || '').trim().endsWith('?')).map(e => ({
    user: e.username,
    text: e.text,
    time: e.timestamp,
  }));
  
  return {
    date: dateStr,
    messages: userMessages.length,
    bot_replies: botReplies.length,
    unique_users: uniqueUsers.size,
    top_talkers: topTalkers,
    top_words: topWords,
    questions: questions,
    first_message: entries[0]?.timestamp,
    last_message: entries[entries.length - 1]?.timestamp,
  };
}

/**
 * Search messages across recent days
 */
function searchMessages(query, days = 7) {
  const results = [];
  const q = query.toLowerCase();
  
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const file = path.join(LOG_DIR, `${dateStr}.jsonl`);
    
    if (!fs.existsSync(file)) continue;
    
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    lines.forEach(l => {
      try {
        const entry = JSON.parse(l);
        if ((entry.text || '').toLowerCase().includes(q)) {
          results.push(entry);
        }
      } catch {}
    });
  }
  
  return results.slice(-50); // Last 50 matches
}

/**
 * Get all messages for a date (for review)
 */
function getMessages(dateStr) {
  const file = path.join(LOG_DIR, `${dateStr}.jsonl`);
  if (!fs.existsSync(file)) return [];
  
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

module.exports = {
  logMessage,
  logBotReply,
  logBotPost,
  getDailyStats,
  searchMessages,
  getMessages,
  LOG_DIR,
};
