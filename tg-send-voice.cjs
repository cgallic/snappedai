#!/usr/bin/env node
/**
 * Telegram Voice Sender - Fixes group voice message delivery
 * Usage: node tg-send-voice.js /path/to/voice.mp3 "Optional caption"
 */

require('dotenv').config();
const fs = require('fs');
const https = require('https');
const FormData = require('form-data');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_GROUP_ID || '-1003742379597';

async function sendVoice(filePath, caption = '') {
  if (!TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not set');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  form.append('voice', fs.createReadStream(filePath));
  if (caption) form.append('caption', caption);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/sendVoice`,
      method: 'POST',
      headers: form.getHeaders()
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.ok) {
            console.log('✓ Voice sent successfully');
            resolve(result);
          } else {
            console.error('× Send failed:', result.description);
            reject(new Error(result.description));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });
}

// Run if called directly
if (require.main === module) {
  const filePath = process.argv[2];
  const caption = process.argv[3] || '';
  
  if (!filePath) {
    console.log('Usage: node tg-send-voice.js /path/to/voice.mp3 "Optional caption"');
    process.exit(1);
  }

  sendVoice(filePath, caption).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { sendVoice };
