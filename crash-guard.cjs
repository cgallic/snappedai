#!/usr/bin/env node
/**
 * crash-guard.cjs — Crash Loop Detection + Self-Repair for SNAP TG Bot
 * 
 * Runs as a separate PM2 process. Monitors snap-tg for:
 * 1. Crash loops (too many restarts in a window)
 * 2. Silent death (process up but no activity)
 * 3. Syntax errors (auto-reverts to last known good)
 * 
 * Actions:
 * - Logs all crashes with timestamps + error excerpts
 * - Auto-reverts to backup on syntax errors
 * - Alerts via TG when intervention needed
 * - Stops the bot if crash-looping to prevent CPU burn
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');

// Config
const BOT_SCRIPT = '/var/www/snap/telegram-bot.cjs';
const BACKUP_DIR = '/var/www/snap/backups';
const CRASH_LOG = '/var/www/snap/api/crash-log.json';
const PM2_NAME = 'snap-tg';
const CHECK_INTERVAL_MS = 30_000; // 30s
const MAX_RESTARTS_PER_WINDOW = 5;
const RESTART_WINDOW_MS = 5 * 60_000; // 5 minutes
const SILENT_DEATH_MS = 15 * 60_000; // 15 min no logs = dead
const TG_ALERT_COOLDOWN_MS = 10 * 60_000; // Don't spam TG alerts

// Load TG credentials
require('dotenv').config({ path: '/var/www/snap/.env' });
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_GROUP_CHAT_ID || '-1002312270498';

// State
let lastAlertTime = 0;
let lastLogSize = 0;
let consecutiveNoActivity = 0;

// Ensure dirs
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function loadCrashLog() {
  try { return JSON.parse(fs.readFileSync(CRASH_LOG, 'utf8')); }
  catch { return { crashes: [], reverts: [], lastCheck: null }; }
}

function saveCrashLog(data) {
  // Keep last 100 entries
  if (data.crashes.length > 100) data.crashes = data.crashes.slice(-100);
  if (data.reverts.length > 50) data.reverts = data.reverts.slice(-50);
  fs.writeFileSync(CRASH_LOG, JSON.stringify(data, null, 2));
}

function getPM2Info() {
  try {
    const raw = execSync(`pm2 jlist`, { encoding: 'utf8', timeout: 5000 });
    const list = JSON.parse(raw);
    return list.find(p => p.name === PM2_NAME);
  } catch (e) {
    log(`PM2 query failed: ${e.message}`);
    return null;
  }
}

function getRecentErrors(lines = 20) {
  try {
    return execSync(
      `tail -${lines} /root/.pm2/logs/snap-tg-error.log 2>/dev/null`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
  } catch { return ''; }
}

function getRecentOutput(lines = 5) {
  try {
    return execSync(
      `tail -${lines} /root/.pm2/logs/snap-tg-out.log 2>/dev/null`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
  } catch { return ''; }
}

function getLogSize() {
  try {
    const stat = fs.statSync('/root/.pm2/logs/snap-tg-out.log');
    return stat.size;
  } catch { return 0; }
}

function sendTGAlert(message) {
  // Log only — no TG messages about crashes (confuses community)
  log(`ALERT (logged only): ${message}`);
}

function createBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `telegram-bot-${ts}.cjs`);
  try {
    fs.copyFileSync(BOT_SCRIPT, backupPath);
    log(`Backup created: ${backupPath}`);
    
    // Keep only last 10 backups
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('telegram-bot-'))
      .sort()
      .reverse();
    for (const old of backups.slice(10)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    }
    return backupPath;
  } catch (e) {
    log(`Backup failed: ${e.message}`);
    return null;
  }
}

function getLatestBackup() {
  try {
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('telegram-bot-'))
      .sort()
      .reverse();
    return backups.length > 0 ? path.join(BACKUP_DIR, backups[0]) : null;
  } catch { return null; }
}

function revertToBackup(reason) {
  const backup = getLatestBackup();
  if (!backup) {
    log('No backup available to revert to!');
    sendTGAlert('Bot crash-looping but NO BACKUP available. Manual intervention needed.');
    return false;
  }
  
  try {
    // Save current broken version for debugging
    const brokenPath = path.join(BACKUP_DIR, `broken-${Date.now()}.cjs`);
    fs.copyFileSync(BOT_SCRIPT, brokenPath);
    
    // Revert
    fs.copyFileSync(backup, BOT_SCRIPT);
    log(`Reverted to backup: ${backup}`);
    
    // Restart
    execSync(`pm2 restart ${PM2_NAME}`, { timeout: 10000 });
    
    const crashLog = loadCrashLog();
    crashLog.reverts.push({
      timestamp: new Date().toISOString(),
      reason,
      backup,
      brokenSaved: brokenPath
    });
    saveCrashLog(crashLog);
    
    sendTGAlert(`Auto-reverted bot to backup.\nReason: ${reason}\nBroken version saved: ${brokenPath}`);
    return true;
  } catch (e) {
    log(`Revert failed: ${e.message}`);
    sendTGAlert(`Revert FAILED: ${e.message}`);
    return false;
  }
}

function diagnoseError(errorText) {
  if (/SyntaxError/.test(errorText)) return 'syntax_error';
  if (/Cannot find module/.test(errorText)) return 'missing_module';
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(errorText)) return 'network_error';
  if (/ENOMEM|heap|memory/.test(errorText)) return 'memory_error';
  if (/EACCES|EPERM/.test(errorText)) return 'permission_error';
  if (/ReferenceError|TypeError/.test(errorText)) return 'code_error';
  return 'unknown';
}

// Main check loop
async function check() {
  const info = getPM2Info();
  const crashLog = loadCrashLog();
  crashLog.lastCheck = new Date().toISOString();
  
  if (!info) {
    log('snap-tg not found in PM2');
    saveCrashLog(crashLog);
    return;
  }
  
  const restarts = info.pm2_env?.restart_time || 0;
  const status = info.pm2_env?.status;
  const uptime = info.pm2_env?.pm_uptime || 0;
  const uptimeMs = Date.now() - uptime;
  
  // 1. Check for crash loop
  const recentCrashes = crashLog.crashes.filter(
    c => Date.now() - new Date(c.timestamp).getTime() < RESTART_WINDOW_MS
  );
  
  if (status === 'errored' || status === 'stopped') {
    const errors = getRecentErrors();
    const diagnosis = diagnoseError(errors);
    
    crashLog.crashes.push({
      timestamp: new Date().toISOString(),
      status,
      restarts,
      diagnosis,
      error: errors.slice(-500)
    });
    saveCrashLog(crashLog);
    
    log(`Bot is ${status}! Diagnosis: ${diagnosis} (${recentCrashes.length + 1} crashes in window)`);
    
    if (diagnosis === 'syntax_error' || diagnosis === 'code_error') {
      log('Code error detected — attempting auto-revert');
      revertToBackup(`${diagnosis}: ${errors.slice(-200)}`);
      return;
    }
    
    if (recentCrashes.length + 1 >= MAX_RESTARTS_PER_WINDOW) {
      log(`Crash loop detected (${recentCrashes.length + 1} in ${RESTART_WINDOW_MS/1000}s). Stopping bot.`);
      try { execSync(`pm2 stop ${PM2_NAME}`, { timeout: 5000 }); } catch {}
      sendTGAlert(`Bot stopped — crash loop detected.\n${recentCrashes.length + 1} crashes in ${RESTART_WINDOW_MS/60000} min.\nDiagnosis: ${diagnosis}\nLast error: ${errors.slice(-200)}`);
      return;
    }
    
    // Try restart for non-code errors
    if (diagnosis === 'network_error') {
      log('Network error — waiting 30s then restarting');
      setTimeout(() => {
        try { execSync(`pm2 restart ${PM2_NAME}`, { timeout: 10000 }); } catch {}
      }, 30000);
    } else {
      try { execSync(`pm2 restart ${PM2_NAME}`, { timeout: 10000 }); } catch {}
    }
    return;
  }
  
  // 2. Check for rapid restarts (bot is "online" but bouncing)
  if (uptimeMs < 60000 && restarts > 0) {
    // Bot just restarted — check if it was a restart storm
    const lastCrash = crashLog.crashes[crashLog.crashes.length - 1];
    if (lastCrash && Date.now() - new Date(lastCrash.timestamp).getTime() < 120000) {
      // Two restarts within 2 min
      const errors = getRecentErrors();
      crashLog.crashes.push({
        timestamp: new Date().toISOString(),
        status: 'rapid_restart',
        restarts,
        diagnosis: diagnoseError(errors),
        error: errors.slice(-300)
      });
      saveCrashLog(crashLog);
    }
  }
  
  // 3. Check for silent death (running but not processing)
  const currentLogSize = getLogSize();
  if (currentLogSize === lastLogSize) {
    consecutiveNoActivity++;
    if (consecutiveNoActivity * CHECK_INTERVAL_MS >= SILENT_DEATH_MS) {
      log(`Silent death detected — no log activity for ${(consecutiveNoActivity * CHECK_INTERVAL_MS / 60000).toFixed(1)} min`);
      // Check if there are actually pending messages (bot might just be quiet)
      const recentOut = getRecentOutput(3);
      if (!recentOut.includes('SNAP bot running')) {
        // Bot isn't even logging its startup — it's truly dead
        try {
          execSync(`pm2 restart ${PM2_NAME}`, { timeout: 10000 });
          log('Restarted silent bot');
          sendTGAlert('Bot was silently dead — auto-restarted.');
        } catch {}
      }
      consecutiveNoActivity = 0;
    }
  } else {
    consecutiveNoActivity = 0;
  }
  lastLogSize = currentLogSize;
  
  saveCrashLog(crashLog);
}

// Create initial backup on startup
log('🛡️ Crash guard starting...');
createBackup();
log(`Monitoring ${PM2_NAME} every ${CHECK_INTERVAL_MS/1000}s`);
log(`Max ${MAX_RESTARTS_PER_WINDOW} crashes per ${RESTART_WINDOW_MS/60000} min before stop`);
log(`Silent death detection after ${SILENT_DEATH_MS/60000} min`);

// Run checks on interval
setInterval(check, CHECK_INTERVAL_MS);
// First check immediately
check();
