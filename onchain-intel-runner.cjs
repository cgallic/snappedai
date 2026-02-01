'use strict';
process.on('uncaughtException', (e) => {
  console.error('[FATAL] Uncaught exception:', e.message);
  console.error(e.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

// Keep process alive no matter what
setInterval(() => {}, 30000);

console.log('[runner] Starting onchain-intel...');

// Dynamic import to catch load errors
try {
  const path = require('path');
  // Re-execute as main
  delete require.cache[require.resolve('./onchain-intel.cjs')];
  
  // Patch require.main
  const Module = require('module');
  const origMain = require.main;
  
  // Just run the file directly
  require('child_process'); // ensure loaded
  
  // Load and run
  const script = require('fs').readFileSync('/var/www/snap/onchain-intel.cjs', 'utf8');
  const vm = require('vm');
  
  // Actually, simplest fix: just call main directly
  const mod = require('./onchain-intel.cjs');
  
  // main() won't auto-run because require.main !== module
  // So we need to find and call it. But main is not exported.
  // Let me just modify the original to also export main.
  console.log('[runner] Module loaded, exports:', Object.keys(mod));
  console.log('[runner] Need to add main to exports or fix the issue differently');
} catch(e) {
  console.error('[runner] Load error:', e.message);
  console.error(e.stack);
}
