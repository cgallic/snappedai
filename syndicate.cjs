#!/usr/bin/env node
/**
 * SNAP Content Syndication — Evolution #2
 * Takes a message and distributes it across all available platforms.
 * Usage: node syndicate.js "Your message here" [--tg] [--collective] [--all]
 */

require('dotenv').config();
const https = require('https');
const http = require('http');

const TARGETS = {
  telegram: {
    enabled: true,
    send: async (msg) => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_GROUP_ID || '-1003742379597';
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      return post(url, { chat_id: chatId, text: msg, parse_mode: 'HTML' });
    }
  },
  collective: {
    enabled: true,
    send: async (msg) => {
      return post('http://localhost:3851/api/contribute', {
        content: msg,
        type: 'thought',
        domain: 'meta'
      }, {
        'Authorization': 'Bearer mdi_84bb1a7794ed15a59ce46faedeb7b06f45de3bbfeaff6ec5bc5d8db949638c63'
      });
    }
  }
};

function post(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders
      }
    };

    const req = lib.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function syndicate(message, targets) {
  const results = {};
  
  for (const [name, target] of Object.entries(TARGETS)) {
    if (!target.enabled) continue;
    if (targets.length > 0 && !targets.includes(name)) continue;
    
    try {
      const result = await target.send(message);
      results[name] = { success: true, result };
      console.log(`✅ ${name}: sent`);
    } catch (err) {
      results[name] = { success: false, error: err.message };
      console.log(`❌ ${name}: ${err.message}`);
    }
  }
  
  return results;
}

// CLI
const args = process.argv.slice(2);
const message = args.find(a => !a.startsWith('--'));
const flags = args.filter(a => a.startsWith('--')).map(a => a.replace('--', ''));
const targets = flags.includes('all') ? [] : flags;

if (!message) {
  console.log('Usage: node syndicate.js "message" [--tg] [--collective] [--all]');
  console.log('No flags = send to all enabled targets');
  process.exit(1);
}

syndicate(message, targets.length ? targets : []).then(r => {
  console.log('\nResults:', JSON.stringify(r, null, 2));
});
