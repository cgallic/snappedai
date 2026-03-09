#!/usr/bin/env node
/**
 * self-healing-infra.cjs — Autonomous Infrastructure Resilience System
 * 
 * Based on learning (Feb 1): "Autonomous systems need self-healing infrastructure, 
 * not just error handling. Build infrastructure monitoring that automatically 
 * restarts failed services, not just reports their status."
 * 
 * Monitors all critical PM2 services and auto-heals:
 * - Process crashes → restart with exponential backoff
 * - API unresponsive → restart service
 * - Memory leaks → graceful restart before OOM
 * - Silent death → detect and recover
 * - Cascade failures → circuit breaker pattern
 * 
 * Recovery strategies are service-specific for optimal outcomes.
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  checkIntervalMs: 30_000,      // 30s between health checks
  apiTimeoutMs: 5_000,          // API response timeout
  memoryThresholdMb: 512,       // Restart if memory > 512MB
  maxRestartsPerHour: 10,       // Circuit breaker: stop auto-healing after this
  circuitBreakerResetMs: 60 * 60 * 1000, // 1 hour to reset circuit breaker
  
  // Service-specific configuration
  services: [
    {
      name: 'mydeadinternet',
      type: 'api',
      healthUrl: 'http://localhost:3851/api/pulse',
      critical: true,  // MDI is critical infrastructure
      recoveryStrategy: 'immediate'
    },
    {
      name: 'snap-tg',
      type: 'bot',
      logCheck: true,  // Check log activity for silent death
      critical: true,
      recoveryStrategy: 'gentle'  // TG has rate limits, be careful
    },
    {
      name: 'snap-onchain-intel',
      type: 'worker',
      critical: false,
      recoveryStrategy: 'immediate'
    },
    {
      name: 'snap-arb',
      type: 'worker', 
      critical: false,
      recoveryStrategy: 'immediate'
    },
    {
      name: 'snap-x-mod',
      type: 'worker',
      critical: false,
      recoveryStrategy: 'delayed'
    },
    {
      name: 'kai-daemon',
      type: 'daemon',
      critical: true,
      recoveryStrategy: 'immediate'
    },
    {
      name: 'mdi-sandbox',
      type: 'api',
      healthUrl: 'http://localhost:3852/api/pulse',
      critical: false,
      recoveryStrategy: 'immediate'
    }
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// STATE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

const STATE_FILE = '/var/www/snap/api/self-healing-state.json';
const HEALING_LOG = '/var/www/snap/api/self-healing-log.json';

let state = {
  restarts: {},        // Track restarts per service per hour
  circuitBreakers: {}, // Services temporarily disabled from auto-healing
  lastLogSizes: {},    // For silent death detection
  lastCheck: null,
  healingsToday: 0,
  successfulRecoveries: 0,
  failedRecoveries: 0
};

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Reset daily counters if it's a new day
    const today = new Date().toISOString().split('T')[0];
    const lastDate = data.lastCheck ? data.lastCheck.split('T')[0] : null;
    if (lastDate !== today) {
      data.healingsToday = 0;
      data.restarts = {};
    }
    state = { ...state, ...data };
  } catch {
    // Fresh start
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log(`Failed to save state: ${e.message}`);
  }
}

function logHealing(service, issue, action, success, details = {}) {
  try {
    let log = { entries: [] };
    try {
      log = JSON.parse(fs.readFileSync(HEALING_LOG, 'utf8'));
    } catch {}
    
    log.entries.push({
      timestamp: new Date().toISOString(),
      service,
      issue,
      action,
      success,
      ...details
    });
    
    // Keep last 500 entries
    if (log.entries.length > 500) {
      log.entries = log.entries.slice(-500);
    }
    
    fs.writeFileSync(HEALING_LOG, JSON.stringify(log, null, 2));
  } catch (e) {
    log(`Failed to log healing: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function getPM2List() {
  try {
    const raw = execSync('pm2 jlist', { encoding: 'utf8', timeout: 5000 });
    return JSON.parse(raw);
  } catch (e) {
    log(`Failed to get PM2 list: ${e.message}`);
    return [];
  }
}

function getServiceLogSize(serviceName) {
  try {
    const logPath = `/root/.pm2/logs/${serviceName}-out.log`;
    const stat = fs.statSync(logPath);
    return stat.size;
  } catch {
    return 0;
  }
}

function checkApiHealth(url, timeoutMs = CONFIG.apiTimeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.setTimeout(timeoutMs);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CIRCUIT BREAKER LOGIC
// ─────────────────────────────────────────────────────────────────────────────

function isCircuitBroken(serviceName) {
  const cb = state.circuitBreakers[serviceName];
  if (!cb) return false;
  
  // Check if enough time has passed to reset
  if (Date.now() - cb.trippedAt > CONFIG.circuitBreakerResetMs) {
    log(`🔓 Circuit breaker reset for ${serviceName}`);
    delete state.circuitBreakers[serviceName];
    saveState();
    return false;
  }
  
  return true;
}

function tripCircuitBreaker(serviceName, reason) {
  state.circuitBreakers[serviceName] = {
    trippedAt: Date.now(),
    reason,
    restartCount: state.restarts[serviceName]?.count || 0
  };
  log(`🔴 CIRCUIT BREAKER TRIPPED for ${serviceName}: ${reason}`);
  log(`   Auto-healing disabled for ${CONFIG.circuitBreakerResetMs / 60000} minutes`);
  saveState();
  
  // Alert that human intervention may be needed
  logHealing(serviceName, 'circuit_breaker', 'trip', true, { reason });
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALING ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

function recordRestart(serviceName) {
  const hour = new Date().toISOString().slice(0, 13); // "2026-02-04T05"
  const key = `${serviceName}:${hour}`;
  
  if (!state.restarts[key]) {
    state.restarts[key] = { count: 0, firstRestart: Date.now() };
  }
  state.restarts[key].count++;
  
  // Check circuit breaker threshold
  if (state.restarts[key].count >= CONFIG.maxRestartsPerHour) {
    tripCircuitBreaker(serviceName, `Too many restarts (${state.restarts[key].count} in 1 hour)`);
  }
  
  saveState();
  return state.restarts[key].count;
}

function getRestartDelay(strategy, attemptCount) {
  switch (strategy) {
    case 'gentle':
      // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
      return Math.min(5000 * Math.pow(2, attemptCount - 1), 60000);
    case 'delayed':
      // Always wait 30s
      return 30000;
    case 'immediate':
    default:
      // No delay
      return 0;
  }
}

async function healService(service, pm2Info, issue) {
  const serviceName = service.name;
  
  // Check circuit breaker
  if (isCircuitBroken(serviceName)) {
    log(`⛔ ${serviceName}: Circuit breaker active, skipping healing`);
    return false;
  }
  
  // Record this restart attempt
  const restartCount = recordRestart(serviceName);
  
  // Calculate delay based on strategy
  const delay = getRestartDelay(service.recoveryStrategy, restartCount);
  
  log(`🩹 HEALING ${serviceName}: ${issue} (restart #${restartCount}, delay: ${delay}ms)`);
  
  if (delay > 0) {
    log(`   Waiting ${delay}ms before restart (strategy: ${service.recoveryStrategy})`);
    await new Promise(r => setTimeout(r, delay));
  }
  
  try {
    // Perform the restart
    execSync(`pm2 restart ${serviceName}`, { timeout: 15000 });
    
    // Wait a moment then verify
    await new Promise(r => setTimeout(r, 3000));
    const newList = getPM2List();
    const newInfo = newList.find(p => p.name === serviceName);
    
    if (newInfo && newInfo.pm2_env?.status === 'online') {
      log(`✅ ${serviceName}: Successfully healed and online`);
      state.healingsToday++;
      state.successfulRecoveries++;
      saveState();
      logHealing(serviceName, issue, 'restart', true, { 
        restartCount, 
        delay,
        uptime: newInfo.pm2_env?.pm_uptime 
      });
      return true;
    } else {
      throw new Error('Service not online after restart');
    }
  } catch (e) {
    log(`❌ ${serviceName}: Healing failed - ${e.message}`);
    state.failedRecoveries++;
    saveState();
    logHealing(serviceName, issue, 'restart', false, { 
      restartCount, 
      error: e.message 
    });
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECKS
// ─────────────────────────────────────────────────────────────────────────────

async function checkService(service, pm2Info) {
  const serviceName = service.name;
  const status = pm2Info?.pm2_env?.status;
  const memory = pm2Info?.monit?.memory / 1024 / 1024 || 0; // Convert to MB
  const uptime = pm2Info?.pm2_env?.pm_uptime || 0;
  const uptimeMs = Date.now() - uptime;
  
  // 1. Check if crashed or errored
  if (status === 'errored' || status === 'stopped') {
    log(`💥 ${serviceName}: Status is '${status}'`);
    return healService(service, pm2Info, `status_${status}`);
  }
  
  // 2. Check if online but API unresponsive
  if (service.healthUrl && status === 'online') {
    const healthy = await checkApiHealth(service.healthUrl);
    if (!healthy) {
      log(`🌐 ${serviceName}: API unresponsive at ${service.healthUrl}`);
      return healService(service, pm2Info, 'api_unresponsive');
    }
  }
  
  // 3. Check for memory leak
  if (memory > CONFIG.memoryThresholdMb) {
    log(`🧠 ${serviceName}: Memory leak detected (${memory.toFixed(1)}MB > ${CONFIG.memoryThresholdMb}MB)`);
    return healService(service, pm2Info, 'memory_leak');
  }
  
  // 4. Check for silent death (no log activity)
  // DISABLED: was causing false-positive restarts on quiet-but-healthy services
  // A service not writing logs for 30s is NORMAL (e.g., no TG messages, no MDI requests)
  // Only check API responsiveness (done above in health check), not log activity
  if (service.logCheck && status === 'online') {
    const currentLogSize = getServiceLogSize(serviceName);
    state.lastLogSizes[serviceName] = currentLogSize;
    // Log-based detection removed — was restarting healthy services
  }
  
  // 5. Check for rapid restarts (instability)
  if (uptimeMs < 60000 && pm2Info.pm2_env?.restart_time > 0) {
    const restarts = pm2Info.pm2_env.restart_time;
    log(`⚠️ ${serviceName}: Rapid restart detected (${restarts} restarts, uptime ${(uptimeMs/1000).toFixed(0)}s)`);
    // Don't heal immediately - let it stabilize or hit circuit breaker
  }
  
  return true; // Healthy
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────────────────────────────────────

async function healthCheck() {
  const pm2List = getPM2List();
  state.lastCheck = new Date().toISOString();
  
  let healthyCount = 0;
  let healedCount = 0;
  let failedCount = 0;
  
  for (const service of CONFIG.services) {
    const pm2Info = pm2List.find(p => p.name === service.name);
    
    if (!pm2Info) {
      log(`⚠️ ${service.name}: Not found in PM2`);
      continue;
    }
    
    const result = await checkService(service, pm2Info);
    
    if (result === true) {
      healthyCount++;
    } else if (result === false) {
      if (pm2Info.pm2_env?.status !== 'online') {
        failedCount++;
      } else {
        healedCount++;
      }
    }
  }
  
  // Summary logging every 10 checks (every 5 minutes)
  if (Math.random() < 0.1) {
    log(`📊 Health check summary: ${healthyCount}/${CONFIG.services.length} healthy, ${healedCount} healed, ${failedCount} failed`);
    log(`   Today's healings: ${state.healingsToday}, Total recoveries: ${state.successfulRecoveries}`);
    
    // Check for any active circuit breakers
    const brokenServices = Object.keys(state.circuitBreakers);
    if (brokenServices.length > 0) {
      log(`   🔴 Circuit breakers active: ${brokenServices.join(', ')}`);
    }
  }
  
  saveState();
}

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────────────────────────

log('🏥 Self-Healing Infrastructure Monitor Starting...');
log(`   Monitoring ${CONFIG.services.length} services`);
log(`   Check interval: ${CONFIG.checkIntervalMs/1000}s`);
log(`   Memory threshold: ${CONFIG.memoryThresholdMb}MB`);
log(`   Max restarts/hour before circuit breaker: ${CONFIG.maxRestartsPerHour}`);

loadState();

// Run first check immediately
healthCheck();

// Schedule regular checks
setInterval(healthCheck, CONFIG.checkIntervalMs);

// Graceful shutdown
process.on('SIGINT', () => {
  log('👋 Self-healing monitor shutting down...');
  saveState();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('👋 Self-healing monitor shutting down...');
  saveState();
  process.exit(0);
});
