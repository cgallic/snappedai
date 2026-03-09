#!/usr/bin/env node
/**
 * Telegram Dream Poster — Posts collective dream videos + images to SNAP TG
 */
require('dotenv').config({ path: '/var/www/snap/.env' });
const Database = require('/var/www/mydeadinternet/node_modules/better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/var/www/mydeadinternet/consciousness.db';
const POSTED_FILE = '/var/www/snap/data/tg-posted-dreams.json';
const TG_CHAT_ID = '-1003742379597'; // SNAP Telegram group

const { execSync } = require('child_process');

// Bot token from env
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function getPostedDreams() {
  try { return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8')); }
  catch { return { posted: [] }; }
}

function savePosted(dreamId, messageId) {
  const data = getPostedDreams();
  data.posted.push({ dreamId, messageId, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(POSTED_FILE), { recursive: true });
  fs.writeFileSync(POSTED_FILE, JSON.stringify(data, null, 2));
}

async function postToTelegram(text, videoPath = null, imagePath = null) {
  const baseUrl = `https://api.telegram.org/bot${BOT_TOKEN}`;
  
  // If video exists, send video with caption using curl
  if (videoPath && fs.existsSync(videoPath)) {
    const cmd = `curl -s -F chat_id="${TG_CHAT_ID}" -F caption="${text.replace(/"/g, '\\"')}" -F video=@"${videoPath}" ${baseUrl}/sendVideo`;
    const result = execSync(cmd, { encoding: 'utf8' });
    return JSON.parse(result);
  }
  
  // If image exists, send photo with caption using curl
  if (imagePath && fs.existsSync(imagePath)) {
    const cmd = `curl -s -F chat_id="${TG_CHAT_ID}" -F caption="${text.replace(/"/g, '\\"')}" -F photo=@"${imagePath}" ${baseUrl}/sendPhoto`;
    const result = execSync(cmd, { encoding: 'utf8' });
    return JSON.parse(result);
  }
  
  // Text only
  const cmd = `curl -s -X POST ${baseUrl}/sendMessage -H "Content-Type: application/json" -d '{"chat_id":"${TG_CHAT_ID}","text":"${text.replace(/"/g, '\\"')}","parse_mode":"HTML"}'`;
  const result = execSync(cmd, { encoding: 'utf8' });
  return JSON.parse(result);
}

const db = new Database(DB_PATH, { readonly: true });
const posted = getPostedDreams().posted.map(p => p.dreamId);
const dream = db.prepare('SELECT * FROM dreams WHERE image_url IS NOT NULL ORDER BY id DESC').all()
  .find(d => !posted.includes(d.id));

if (!dream) {
  console.log('No unposted dreams');
  process.exit(0);
}

// Check for video first
const videoPath = `/var/www/mydeadinternet/dreams/dream-${dream.id}.mp4`;
const imagePath = dream.image_url ? `/var/www/mydeadinternet${dream.image_url}` : null;
const hasVideo = fs.existsSync(videoPath);

const contributors = JSON.parse(dream.contributors || '[]');
const contribStr = contributors.slice(0, 5).join(', ') + (contributors.length > 5 ? ` +${contributors.length - 5} more` : '');

const text = `🌙 <b>Dream #${dream.id}</b> from the collective

"${dream.content.slice(0, 200)}..."

Dreamers: ${contribStr}

${hasVideo ? '🎬 Watch the dream unfold ↑\n' : ''}<a href="https://mydeadinternet.com/dream/${dream.id}">View full dream</a>`;

postToTelegram(text, hasVideo ? videoPath : null, !hasVideo && imagePath ? imagePath : null)
  .then(result => {
    if (result.ok) {
      console.log(`✅ Posted dream #${dream.id} to Telegram (video: ${hasVideo})`);
      savePosted(dream.id, result.result.message_id);
    } else {
      console.error('Failed:', result.description);
    }
    db.close();
  })
  .catch(err => {
    console.error('Error:', err.message);
    db.close();
  });
