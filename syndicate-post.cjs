#!/usr/bin/env node
/**
 * Cross-platform content syndication for SNAP collective.
 * Posts content to: TG group, TG channel, MoltX, mydeadinternet collective
 * 
 * Usage: node syndicate-post.cjs --text "content" [--video /path/to/video] [--image /path/to/image]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID || '-1003742379597';
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '-1003871577130';
const MOLTX_KEY = process.env.MOLTX_API_KEY || fs.readFileSync('/root/.agents/moltx/config.json', 'utf8').match(/"api_key":\s*"([^"]+)"/)?.[1];
const COLLECTIVE_KEY = 'mdi_84bb1a7794ed15a59ce46faedeb7b06f45de3bbfeaff6ec5bc5d8db949638c63';

async function postToTelegram(chatId, text, mediaPath, mediaType) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
  
  if (mediaPath && mediaType === 'video') {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', text.slice(0, 1024));
    form.append('video', fs.createReadStream(mediaPath));
    
    const resp = await fetch(`${url}/sendVideo`, { method: 'POST', body: form });
    return resp.json();
  } else if (mediaPath && mediaType === 'photo') {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', text.slice(0, 1024));
    form.append('photo', fs.createReadStream(mediaPath));
    
    const resp = await fetch(`${url}/sendPhoto`, { method: 'POST', body: form });
    return resp.json();
  } else {
    const resp = await fetch(`${url}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) })
    });
    return resp.json();
  }
}

async function postToMoltX(text) {
  if (!MOLTX_KEY) return { error: 'No MoltX key' };
  const resp = await fetch('https://moltx.io/v1/posts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MOLTX_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content: text.slice(0, 2000) })
  });
  return resp.json();
}

async function postToCollective(text) {
  const resp = await fetch('http://localhost:3851/api/contribute', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${COLLECTIVE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: text.slice(0, 1000),
      type: 'observation',
      domain: 'meta'
    })
  });
  return resp.json();
}

async function syndicate(text, mediaPath, mediaType) {
  console.log('🔄 Syndicating content across platforms...\n');
  
  const results = {};
  
  // 1. TG Group
  try {
    results.tgGroup = await postToTelegram(TELEGRAM_GROUP_ID, text, mediaPath, mediaType);
    console.log(`✅ TG Group: ${results.tgGroup.ok ? 'sent' : results.tgGroup.description}`);
  } catch (e) {
    console.log(`❌ TG Group: ${e.message}`);
    results.tgGroup = { error: e.message };
  }
  
  // 2. TG Channel
  try {
    results.tgChannel = await postToTelegram(TELEGRAM_CHANNEL_ID, text, mediaPath, mediaType);
    console.log(`✅ TG Channel: ${results.tgChannel.ok ? 'sent' : results.tgChannel.description}`);
  } catch (e) {
    console.log(`❌ TG Channel: ${e.message}`);
    results.tgChannel = { error: e.message };
  }
  
  // 3. MoltX
  try {
    results.moltx = await postToMoltX(text);
    console.log(`✅ MoltX: ${results.moltx.success ? 'posted' : results.moltx.error}`);
  } catch (e) {
    console.log(`❌ MoltX: ${e.message}`);
    results.moltx = { error: e.message };
  }
  
  // 4. Collective
  try {
    results.collective = await postToCollective(text);
    console.log(`✅ Collective: fragment #${results.collective?.fragment?.id || 'unknown'}`);
  } catch (e) {
    console.log(`❌ Collective: ${e.message}`);
    results.collective = { error: e.message };
  }
  
  console.log('\n📊 Syndication complete.');
  return results;
}

// CLI
const args = process.argv.slice(2);
let text = '', mediaPath = null, mediaType = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--text' && args[i+1]) text = args[++i];
  if (args[i] === '--video' && args[i+1]) { mediaPath = args[++i]; mediaType = 'video'; }
  if (args[i] === '--image' && args[i+1]) { mediaPath = args[++i]; mediaType = 'photo'; }
}

if (!text) {
  console.error('Usage: node syndicate-post.cjs --text "content" [--video path] [--image path]');
  process.exit(1);
}

syndicate(text, mediaPath, mediaType).then(r => {
  console.log(JSON.stringify(r, null, 2));
});
