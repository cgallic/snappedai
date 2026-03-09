#!/usr/bin/env node
/**
 * Agent Error Recovery Assistant
 * Helps agents diagnose and fix common operational failures
 * Usage: node error-recovery.cjs --check [logs|balance|apis|config]
 */

const { exec } = require('child_process');
const fs = require('fs');

const CHECKS = {
  balance: async () => {
    // Check SOL balance for gas
    const balance = await getSOLBalance();
    if (balance < 0.01) return { error: 'Low SOL balance', fix: 'Transfer SOL for gas reserves', critical: true };
    return { ok: 'SOL balance sufficient' };
  },
  
  apis: async () => {
    // Check API endpoints
    const checks = await Promise.all([
      checkAPI('https://api.mainnet-beta.solana.com', 'Solana RPC'),
      checkAPI('http://localhost:3851/api/status', 'Collective API'),
    ]);
    const failures = checks.filter(c => c.error);
    return failures.length ? { error: `${failures.length} APIs down`, fixes: failures } : { ok: 'All APIs responding' };
  },
  
  memory: async () => {
    // Check memory/heartbeat state
    const stateFile = '/root/clawd/memory/heartbeat-state.json';
    if (!fs.existsSync(stateFile)) return { error: 'Missing heartbeat state', fix: 'Initialize state file' };
    try {
      const state = JSON.parse(fs.readFileSync(stateFile));
      const lastCheck = Math.max(...Object.values(state.lastChecks || {}).filter(x => x));
      const staleness = Date.now()/1000 - lastCheck;
      if (staleness > 7200) return { warning: 'Stale heartbeat state', age: staleness + 's' };
      return { ok: 'Heartbeat state current' };
    } catch (e) {
      return { error: 'Corrupt heartbeat state', fix: 'Reset state file' };
    }
  }
};

async function getSOLBalance() {
  return new Promise((resolve) => {
    exec('solana balance 4DGfMLB5rJBBVqVRXoSrGcFMzYMMHpeFUHhNrbvX9c9Z --url mainnet-beta 2>/dev/null', (err, stdout) => {
      const match = stdout.match(/([0-9.]+) SOL/);
      resolve(match ? parseFloat(match[1]) : 0);
    });
  });
}

async function checkAPI(url, name) {
  try {
    const response = await fetch(url);
    return response.ok ? { ok: name } : { error: `${name} HTTP ${response.status}` };
  } catch (e) {
    return { error: `${name} unreachable: ${e.message}` };
  }
}

async function main() {
  const check = process.argv[3];
  if (!check || !CHECKS[check]) {
    console.log('Usage: node error-recovery.cjs --check [balance|apis|memory]');
    process.exit(1);
  }
  
  console.log(`🔍 Checking ${check}...`);
  const result = await CHECKS[check]();
  
  if (result.error) {
    console.log(`❌ ${result.error}`);
    if (result.fix) console.log(`💡 Fix: ${result.fix}`);
    process.exit(1);
  } else if (result.warning) {
    console.log(`⚠️  ${result.warning}`);
  } else {
    console.log(`✅ ${result.ok}`);
  }
}

if (require.main === module) main();
