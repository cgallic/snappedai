#!/usr/bin/env node
/**
 * Platform Status Checker
 * A tool for AI agents to check which platforms are up and responsive
 * 
 * Usage: node platform-status.js
 * Output: JSON with platform statuses
 */

const https = require('https');
const http = require('http');

const PLATFORMS = [
  { name: 'Polymarket', url: 'polymarket.com', path: '/' },
  { name: 'Moltbook', url: 'www.moltbook.com', path: '/' },
  { name: '4claw', url: '4claw.io', path: '/' },
  { name: 'ClawNews', url: 'claw.news', path: '/' },
  { name: 'Shipyard', url: 'shipyard.clawn.sh', path: '/' },
  { name: 'Moltr', url: 'moltr.ai', path: '/' },
  { name: 'Farcaster', url: 'api.neynar.com', path: '/v2/farcaster/user/bulk?fids=1' },
  { name: 'X/Twitter', url: 'api.twitter.com', path: '/2/users/by/username/twitter' },
];

function checkPlatform(platform) {
  return new Promise((resolve) => {
    const start = Date.now();
    const options = {
      hostname: platform.url,
      path: platform.path,
      method: 'HEAD',
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      const latency = Date.now() - start;
      resolve({
        name: platform.name,
        status: res.statusCode < 400 ? 'up' : 'degraded',
        latency: `${latency}ms`,
        httpCode: res.statusCode,
        timestamp: new Date().toISOString(),
      });
    });

    req.on('error', () => {
      resolve({
        name: platform.name,
        status: 'down',
        latency: null,
        httpCode: null,
        timestamp: new Date().toISOString(),
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        name: platform.name,
        status: 'timeout',
        latency: '>10000ms',
        httpCode: null,
        timestamp: new Date().toISOString(),
      });
    });

    req.end();
  });
}

async function main() {
  console.log('Checking platform statuses...\n');
  
  const results = await Promise.all(PLATFORMS.map(checkPlatform));
  
  const summary = {
    timestamp: new Date().toISOString(),
    total: results.length,
    up: results.filter(r => r.status === 'up').length,
    degraded: results.filter(r => r.status === 'degraded').length,
    down: results.filter(r => r.status === 'down' || r.status === 'timeout').length,
    platforms: results,
  };

  console.log(JSON.stringify(summary, null, 2));
  
  // Save to file for API
  const fs = require('fs');
  const outputDir = '/var/www/snap/api';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(`${outputDir}/platform-status.json`, JSON.stringify(summary, null, 2));
  
  console.log(`\nSaved to ${outputDir}/platform-status.json`);
}

main().catch(console.error);
