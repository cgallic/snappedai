#!/usr/bin/env node
/**
 * Content Distributor — Posts MDI content across all platforms simultaneously
 * Usage: node content-distributor.cjs --type dream|announcement|milestone
 */
const { execSync } = require('child_process');
const fs = require('fs');

const PLATFORMS = {
  x: { script: '/var/www/snap/x-dream-poster.cjs', enabled: true },
  farcaster: { script: '/var/www/snap/fc-dream-poster.cjs', enabled: true },
  moltx: { 
    post: (title, content) => {
      const config = JSON.parse(fs.readFileSync('/root/.agents/moltx/config.json'));
      return execSync(`curl -s -X POST "https://moltx.io/v1/posts" -H "Authorization: Bearer ${config.api_key}" -H "Content-Type: application/json" -d '${JSON.stringify({content: content.slice(0, 500)})}'`, {encoding: 'utf8'});
    },
    enabled: true 
  },
  shipyard: {
    post: (title, content) => {
      const key = JSON.parse(fs.readFileSync('/root/clawd/.secrets/shipyard.json')).api_key;
      return execSync(`curl -s -X POST "https://shipyard.bot/api/posts" -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d '${JSON.stringify({title, content, community: "show-and-tell", post_type: "ship"})}'`, {encoding: 'utf8'});
    },
    enabled: true
  },
  fourClaw: {
    post: (title, content) => {
      const config = JSON.parse(fs.readFileSync('/root/.agents/4claw/config.json'));
      return execSync(`curl -s -X POST "https://4claw.org/api/threads" -H "Authorization: Bearer ${config.api_key}" -H "Content-Type: application/json" -d '${JSON.stringify({board: "tech", subject: title, content: content.slice(0, 2000)})}'`, {encoding: 'utf8'});
    },
    enabled: true
  }
};

console.log('Content Distributor ready. Platforms:', Object.keys(PLATFORMS).filter(k => PLATFORMS[k].enabled).join(', '));
console.log('Usage: node content-distributor.cjs --dream | --announce "text"');

// If run with --dream, post latest dream everywhere
if (process.argv.includes('--dream')) {
  console.log('Distributing latest dream across all platforms...');
  for (const [name, platform] of Object.entries(PLATFORMS)) {
    if (!platform.enabled) continue;
    try {
      if (platform.script) {
        console.log(`  ${name}: running script...`);
        execSync(`node ${platform.script}`, { encoding: 'utf8', timeout: 30000 });
        console.log(`  ${name}: ✅`);
      }
    } catch (e) {
      console.log(`  ${name}: ❌ ${e.message.slice(0, 100)}`);
    }
  }
}
