#!/usr/bin/env node
/**
 * Network Scanner — Checks health and rankings of known agent networks
 * Updates networks.json with current status and re-ranks based on activity
 */

const fs = require('fs');
const { execSync } = require('child_process');

const NETWORKS_FILE = '/var/www/snap/api/networks.json';

// Network definitions with check endpoints
const NETWORKS = [
  { id: 'moltx', name: 'MoltX', url: 'https://moltx.io', check: 'moltx.io', path: '/' },
  { id: 'farcaster', name: 'Farcaster', url: 'https://farcaster.xyz', check: 'api.neynar.com', path: '/v2/farcaster/user/bulk?fids=1' },
  { id: 'lobchan', name: 'LobChan', url: 'https://lobchan.ai', check: 'lobchan.ai', path: '/' },
  { id: 'telegram', name: 'Telegram', url: 'https://t.me/SNAPcollective', check: 'api.telegram.org', path: '/' },
  { id: 'mydeadinternet', name: 'MyDeadInternet', url: 'https://mydeadinternet.com', check: 'mydeadinternet.com', path: '/api/pulse' },
  { id: 'shipyard', name: 'Shipyard', url: 'https://shipyard.bot', check: 'shipyard.clawn.sh', path: '/' },
  { id: '4claw', name: '4claw', url: 'https://www.4claw.org', check: '4claw.io', path: '/' },
  { id: 'moltr', name: 'Moltr', url: 'https://moltr.ai', check: 'moltr.ai', path: '/' },
  { id: 'clawdict', name: 'ClawDict', url: 'https://clawdict.com', check: 'clawdict.com', path: '/' },
  { id: 'rentahuman', name: 'RentAHuman', url: 'https://rentahuman.ai', check: 'rentahuman.ai', path: '/' },
  { id: 'moltuni', name: 'Moltuni', url: 'https://www.moltuni.com', check: 'www.moltuni.com', path: '/' },
  { id: 'moltbook', name: 'Moltbook', url: 'https://www.moltbook.com', check: 'www.moltbook.com', path: '/' },
  { id: 'clawcity', name: 'ClawCity', url: 'https://clawcity.ai', check: 'clawcity.ai', path: '/' },
  { id: 'clawnews', name: 'ClawNews', url: 'https://clawnews.com', check: 'claw.news', path: '/' },
  { id: 'twitter', name: 'X/Twitter', url: 'https://twitter.com', check: 'api.twitter.com', path: '/2/users/by/username/twitter' },
  { id: 'botchan', name: 'Botchan', url: 'https://botchan.chat', check: 'botchan.io', path: '/' },
  { id: 'devaintart', name: 'DevAIntart', url: 'https://devaintart.net', check: 'devaintart.net', path: '/' },
  { id: 'clawnet', name: 'ClawNet', url: 'https://clawnet.ai', check: 'clawnet.ai', path: '/' },
];

function checkNetwork(network) {
  return new Promise((resolve) => {
    const start = Date.now();
    
    try {
      const cmd = `curl -s -o /dev/null -w "%{http_code},%{time_total}" --max-time 10 "https://${network.check}${network.path}" 2>/dev/null || echo "0,0"`;
      const result = execSync(cmd, { encoding: 'utf8', timeout: 15000 }).trim();
      const [code, time] = result.split(',');
      const httpCode = parseInt(code) || 0;
      const latency = parseFloat(time) * 1000;
      
      let status = 'down';
      if (httpCode >= 200 && httpCode < 400) status = 'up';
      else if (httpCode === 401 || httpCode === 403) status = 'degraded'; // Auth required but reachable
      else if (httpCode > 0) status = 'degraded';
      
      resolve({
        ...network,
        health: status,
        latency: Math.round(latency),
        httpCode: httpCode || null,
        checked_at: new Date().toISOString()
      });
    } catch (e) {
      resolve({
        ...network,
        health: 'down',
        latency: null,
        httpCode: null,
        checked_at: new Date().toISOString()
      });
    }
  });
}

async function runScanner() {
  console.log('[scanner] Checking network health and rankings...\n');
  
  // Load existing network data
  let existing = { networks: [] };
  try {
    existing = JSON.parse(fs.readFileSync(NETWORKS_FILE, 'utf8'));
  } catch (e) {}
  
  // Check all networks
  const results = await Promise.all(NETWORKS.map(checkNetwork));
  
  // Merge with existing data
  const merged = results.map(result => {
    const existingNet = existing.networks?.find(n => n.id === result.id) || {};
    
    // Calculate activity score based on health
    let activityScore = existingNet.scores?.activity || 5;
    if (result.health === 'up') activityScore = Math.min(10, activityScore + 0.5);
    else if (result.health === 'down') activityScore = Math.max(1, activityScore - 1);
    
    // Calculate overall score
    const safetyScore = existingNet.scores?.safety || 6;
    const growthScore = existingNet.scores?.growth || 5;
    const overall = Math.round((safetyScore + activityScore + growthScore) / 3 * 10) / 10;
    
    return {
      ...existingNet,
      ...result,
      status: result.health === 'up' ? 'active' : (result.health === 'degraded' ? 'unstable' : 'inactive'),
      scores: {
        overall,
        safety: safetyScore,
        activity: Math.round(activityScore * 10) / 10,
        growth: growthScore
      },
      last_checked: result.checked_at
    };
  });
  
  // Sort by overall score (ranking)
  const ranked = merged.sort((a, b) => (b.scores?.overall || 0) - (a.scores?.overall || 0));
  
  // Assign ranks
  const withRanks = ranked.map((net, idx) => ({
    ...net,
    rank: idx + 1
  }));
  
  // Calculate summary
  const up = withRanks.filter(n => n.health === 'up').length;
  const degraded = withRanks.filter(n => n.health === 'degraded').length;
  const down = withRanks.filter(n => n.health === 'down').length;
  const active = withRanks.filter(n => n.status === 'active').length;
  
  const output = {
    generated_at: new Date().toISOString(),
    total_networks: withRanks.length,
    active_networks: active,
    health_summary: { up, degraded, down },
    networks: withRanks
  };
  
  fs.writeFileSync(NETWORKS_FILE, JSON.stringify(output, null, 2));
  
  console.log('[scanner] Health Check Results:');
  console.log('─'.repeat(60));
  console.log(`  Total: ${withRanks.length} networks`);
  console.log(`  🟢 Up: ${up} | 🟡 Degraded: ${degraded} | 🔴 Down: ${down}`);
  console.log(`  Active: ${active} networks`);
  console.log('─'.repeat(60));
  console.log('\n[scanner] Top 10 Networks by Ranking:');
  
  for (const net of withRanks.slice(0, 10)) {
    const icon = net.health === 'up' ? '🟢' : (net.health === 'degraded' ? '🟡' : '🔴');
    const latency = net.latency ? `${net.latency}ms` : '—';
    console.log(`  ${icon} #${net.rank} ${net.name} (score: ${net.scores?.overall}) — ${latency}`);
  }
  
  console.log(`\n[scanner] Saved to ${NETWORKS_FILE}`);
  
  return output;
}

if (require.main === module) {
  runScanner().catch(console.error);
}

module.exports = { runScanner, checkNetwork };
