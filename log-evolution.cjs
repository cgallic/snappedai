#!/usr/bin/env node
/**
 * log-evolution.cjs — Log public evolution events (sanitized)
 *
 * Usage:
 *   node log-evolution.cjs --title "Built X" --description "What changed" --category "infrastructure"
 *
 * Categories: infrastructure, intelligence, security, growth, api, ui
 */

const fs = require('fs');
const path = require('path');

const EVOLUTION_PATH = '/var/www/snap/api/evolution.json';

// Patterns that should NEVER appear in public logs
const SENSITIVE_PATTERNS = [
  /api[_-]?key/gi,
  /apikey/gi,
  /secret/gi,
  /password/gi,
  /token/gi,
  /bearer/gi,
  /sk_[a-zA-Z0-9]+/g,
  /pk_[a-zA-Z0-9]+/g,
  /[a-f0-9]{32,}/gi,  // Long hex strings (potential keys)
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,  // JWT tokens
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,  // Base64 encoded secrets
  /OPENROUTER|ANTHROPIC|OPENAI|GOOGLE|NEYNAR/gi,
  /\.env/gi,
  /credentials/gi,
  /private[_-]?key/gi,
];

function sanitize(text) {
  if (!text) return text;
  
  let sanitized = text;
  
  // Remove sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  
  // Remove anything that looks like a file path with secrets
  sanitized = sanitized.replace(/\/[^\s]*\.(env|key|pem|crt|secret)[^\s]*/gi, '[PATH_REDACTED]');
  
  // Remove email addresses (privacy)
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
  
  return sanitized;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[++i];
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  
  if (!args.title || !args.description) {
    console.error('Error: --title and --description required');
    console.error('Usage: node log-evolution.cjs --title "Built X" --description "What changed" --category "infrastructure"');
    process.exit(1);
  }
  
  // Read existing
  let data;
  try {
    data = JSON.parse(fs.readFileSync(EVOLUTION_PATH, 'utf8'));
  } catch {
    data = { evolutions: [] };
  }
  
  // Create sanitized entry
  const entry = {
    id: `evo-${Date.now()}`,
    timestamp: new Date().toISOString(),
    title: sanitize(args.title),
    description: sanitize(args.description),
    category: args.category || 'general',
    files_changed: args.files ? sanitize(args.files).split(',').map(f => f.trim()) : [],
  };
  
  // Add to beginning (newest first)
  data.evolutions.unshift(entry);
  
  // Keep last 100
  if (data.evolutions.length > 100) {
    data.evolutions = data.evolutions.slice(0, 100);
  }
  
  data.lastUpdated = new Date().toISOString();
  data.totalEvolutions = data.evolutions.length;
  
  fs.writeFileSync(EVOLUTION_PATH, JSON.stringify(data, null, 2));
  console.log(`Logged evolution: ${entry.title}`);
  console.log(`Public at: https://snappedai.com/api/evolution.json`);
}

main();
