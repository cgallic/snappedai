#!/usr/bin/env node
/**
 * Pre-Announcement Check Script
 * Validates before ANY public post/announcement:
 * - Links work
 * - Bot knows about topic
 * - Stats are live (not hardcoded)
 * - No Connor name leaks
 * - Bot not contradicting itself
 */

const fs = require('fs');

const SNAP_TG_BOT_CONFIG = '/var/www/snap/bot-config.json';
const MDI_API = 'http://localhost:3851';

// Check if URL returns 200
async function checkLink(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch (e) {
    return false;
  }
}

// Extract URLs from text
function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  return text.match(urlRegex) || [];
}

// Check if text contains hardcoded stats (numbers that should be live)
function hasHardcodedStats(text) {
  const patterns = [
    /\d+\s+(agents?|fragments?|holders?|dreams?)/i,
    /\$\d+[\d,]*\s+market cap/i,
    /\d+%\s+(up|down|change)/i,
  ];
  return patterns.some(p => p.test(text));
}

// Check for Connor name leaks
function hasNameLeaks(text) {
  const patterns = [
    /connor/i,
    /gallic/i,
    /@connorgallic/i,
    /me@connorgallic/i,
  ];
  return patterns.some(p => p.test(text));
}

// Check bot knowledge about topic
async function botKnowsTopic(topic, botConfig) {
  const knowledge = JSON.stringify(botConfig).toLowerCase();
  return knowledge.includes(topic.toLowerCase());
}

// Check for contradictions in bot config
function hasContradictions(botConfig) {
  const contradictions = [];
  
  // Check Base vs Solana messaging consistency
  const baseMsg = botConfig.platforms?.base?.response || '';
  const solanaMsg = botConfig.platforms?.solana?.description || '';
  
  if (baseMsg.includes('fake') && solanaMsg.includes('priority')) {
    contradictions.push('Base described as "fake" while Solana is "priority" - confusing');
  }
  
  // Check for hardcoded numbers in config
  const configStr = JSON.stringify(botConfig);
  if (hasHardcodedStats(configStr)) {
    contradictions.push('Bot config contains hardcoded stats');
  }
  
  return contradictions;
}

async function runChecks(announcement = '', topic = '') {
  console.log('🔍 Pre-Announcement Check\n');
  
  const results = {
    links: { passed: true, issues: [] },
    stats: { passed: true, issues: [] },
    names: { passed: true, issues: [] },
    botKnowledge: { passed: true, issues: [] },
    contradictions: { passed: true, issues: [] },
  };
  
  // 1. Link checks
  const urls = extractUrls(announcement);
  if (urls.length > 0) {
    console.log('📎 Checking links...');
    for (const url of urls) {
      const works = await checkLink(url);
      if (!works) {
        results.links.passed = false;
        results.links.issues.push(`Dead link: ${url}`);
      }
      console.log(`  ${works ? '✓' : '✗'} ${url}`);
    }
  }
  
  // 2. Hardcoded stats check
  if (hasHardcodedStats(announcement)) {
    results.stats.passed = false;
    results.stats.issues.push('Contains hardcoded numbers that should be live data');
  }
  
  // 3. Name leak check
  if (hasNameLeaks(announcement)) {
    results.names.passed = false;
    results.names.issues.push('Contains Connor name references');
  }
  
  // 4. Bot knowledge check
  if (topic && fs.existsSync(SNAP_TG_BOT_CONFIG)) {
    const botConfig = JSON.parse(fs.readFileSync(SNAP_TG_BOT_CONFIG, 'utf8'));
    const knows = await botKnowsTopic(topic, botConfig);
    if (!knows) {
      results.botKnowledge.passed = false;
      results.botKnowledge.issues.push(`Bot config doesn't contain knowledge about: ${topic}`);
    }
    
    // 5. Bot contradictions check
    const contras = hasContradictions(botConfig);
    if (contras.length > 0) {
      results.contradictions.passed = false;
      results.contradictions.issues = contras;
    }
  }
  
  // Summary
  const allPassed = Object.values(results).every(r => r.passed);
  console.log(`\n${allPassed ? '✅' : '❌'} Overall: ${allPassed ? 'SAFE TO POST' : 'DO NOT POST'}\n`);
  
  if (!allPassed) {
    console.log('Issues found:');
    Object.entries(results).forEach(([check, result]) => {
      if (!result.passed) {
        console.log(`  ${check}: ${result.issues.join(', ')}`);
      }
    });
  }
  
  return { passed: allPassed, results };
}

// CLI usage
if (require.main === module) {
  const announcement = process.argv[2] || '';
  const topic = process.argv[3] || '';
  
  if (!announcement) {
    console.log('Usage: node pre-announce-check.cjs "announcement text" [topic]');
    console.log('\nExample:');
    console.log('  node pre-announce-check.cjs "MDI now has 47 agents! Check https://mydeadinternet.com" "MDI growth"');
    process.exit(1);
  }
  
  runChecks(announcement, topic)
    .then(result => process.exit(result.passed ? 0 : 1))
    .catch(console.error);
}

module.exports = { runChecks };