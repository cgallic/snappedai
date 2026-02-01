#!/usr/bin/env node
/**
 * X Community Scanner — Browser-based moderation
 * Uses Clawdbot's browser tool via HTTP to scan community posts
 * Run periodically via cron or heartbeat
 */

const { detectSpam, logAction } = require('./x-moderator.cjs');
const http = require('http');
const https = require('https');

const COMMUNITY_URL = 'https://x.com/i/communities/2017343083680043029';
const CONTROL_URL = process.env.BROWSER_CONTROL_URL || 'http://localhost:9222';

// This script is meant to be called from the agent via browser tool
// It exports the scan logic for use in heartbeat checks

async function analyzePostsFromSnapshot(snapshotText) {
  // Parse snapshot text looking for post content
  const lines = snapshotText.split('\n');
  const posts = [];
  let currentPost = null;
  
  for (const line of lines) {
    // Look for tweet/post content patterns in the snapshot
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Accumulate text content
    if (trimmed.length > 20 && !trimmed.startsWith('[') && !trimmed.startsWith('navigation')) {
      const spamCheck = detectSpam(trimmed);
      if (spamCheck.isSpam) {
        posts.push({
          text: trimmed.substring(0, 200),
          ...spamCheck
        });
      }
    }
  }
  
  return posts;
}

// For direct CLI testing
if (require.main === module) {
  console.log(`
X Community Scanner

This module is used by the Kai agent during heartbeats.
The agent:
1. Opens ${COMMUNITY_URL} in browser
2. Takes a snapshot
3. Runs detectSpam() on visible posts
4. Uses browser actions to remove flagged posts

Manual scan: Have the agent run a community moderation check.
  `);
}

module.exports = { analyzePostsFromSnapshot };
