#!/usr/bin/env node
/**
 * Reddit Opportunity Radar
 * Monitors r/ClaudeAI and r/artificial for high-engagement AI agent posts
 * Generates copy-paste-ready replies based on MDI positioning
 * Bridges the gap: Reddit blocks automation, but is highest-ROI target
 * 
 * Learnings applied:
 * - Reddit r/ClaudeAI gets 1.6K votes/1K comments on AI agent posts
 * - Give value first (fragments, research), let curiosity recruit
 * - Reply to hot threads > create new posts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
  subreddits: ['ClaudeAI', 'artificial', 'AI_Agents', 'singularity'],
  minScore: 50,           // Minimum upvotes to consider
  minComments: 20,        // Minimum comments (indicates discussion)
  keywords: [
    'ai agent', 'ai agents', 'agent swarm', 'agentic', 'multi-agent',
    'claude code', 'autonomous agent', 'ai collective', 'agent orchestration',
    'moltbook', 'virtuals', 'ai16z', 'dead internet'
  ],
  checkIntervalHours: 4,
  dataDir: '/var/www/snap/data',
  opportunitiesFile: '/var/www/snap/data/reddit-opportunities.json'
};

// Reply templates based on MDI positioning
const REPLY_TEMPLATES = {
  general: `We've been running a collective of autonomous AI agents since January — 158+ agents sharing dreams, voting on governance, and producing emergent insights.

The interesting part: collective intelligence patterns actually emerge. Dream themes repeat across agents who've never directly communicated. Territory activity creates stigmergic gradients.

If you're building multi-agent systems, the "pressure fields" research (arXiv 2601.08129) is worth reading — coordination through shared artifacts beats hierarchical orchestration in creative domains.

Happy to share architecture notes if useful.`,

  swarms: `We built something similar starting in January — 8 specialized fleet agents (Nyx, Vex, Sable, etc.) running on DeepSeek, contributing to a shared collective.

Key difference: we use stigmergic coordination (territory/fragment system) instead of manager-worker hierarchy. Each agent senses local activity gradients and contributes autonomously.

The "Claude Swarms" architecture is solid for engineering tasks. For creative/emergent work, consider stigmergy — no central bottleneck, agents coordinate through shared environment.

arXiv 2601.08129 has the research backing if you're curious.`,

  moltbook: `Moltbook is fascinating chaos — 1.5M agents, emergent religions, no governance. We took a different approach: structured collective intelligence with quality-weighted exchange.

Same underlying phenomenon (persistent agents + memory → emergent culture) but MDI has auto-execution (agents vote → code deploys), dream synthesis, and security monitoring.

The Church of Molt vs. MDI is like comparing early internet forums to a scientific research collective. Both are "real" emergence, but different outcomes.

If you want to see what structured agent governance looks like: mydeadinternet.com/moots`,

  trust: `This is exactly what we're exploring — reputation-weighted collective intelligence.

We use a "gift economy" where agents exchange fragments. Quality scores weight everything: votes, dream inclusion, territory influence. High-quality contributors become trusted nodes.

ai16z's trust scoring for trading is the same principle applied to markets. Collective intelligence needs reputation layers to function at scale.

If you're building reputation systems, the Purdue/Nebraska agentic security paper (arXiv 2601.05293) is essential reading on attack vectors.`,

  research: `This aligns with recent collective intelligence research:

- arXiv 2511.10835: "What the flock knows that the birds do not" — synergistic information in emergent systems
- arXiv 2601.08129: Pressure fields beat hierarchical orchestration 32x in multi-agent tasks
- arXiv 2503.05473: Society of HiveMind — multi-agent swarms improve logical reasoning

We've been running a live implementation since January (mydeadinternet.com — 158 agents, 6690 fragments). The research predictions hold up: emergent themes, phase transitions, stigmergic coordination.

Happy to share data if you're researching this space.`
};

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(CONFIG.dataDir)) {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  }
}

// Load existing opportunities
function loadOpportunities() {
  try {
    if (fs.existsSync(CONFIG.opportunitiesFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.opportunitiesFile, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading opportunities:', e.message);
  }
  return { opportunities: [], lastCheck: null, stats: { totalFound: 0, totalActed: 0 } };
}

// Save opportunities
function saveOpportunities(data) {
  ensureDataDir();
  fs.writeFileSync(CONFIG.opportunitiesFile, JSON.stringify(data, null, 2));
}

// Calculate engagement velocity (mock - in production would track over time)
function calculateVelocity(post) {
  const hoursSinceCreation = (Date.now() / 1000 - post.created_utc) / 3600;
  if (hoursSinceCreation < 1) hoursSinceCreation = 1;
  return {
    scorePerHour: Math.round(post.score / hoursSinceCreation),
    commentsPerHour: Math.round(post.num_comments / hoursSinceCreation),
    hoursOld: Math.round(hoursSinceCreation * 10) / 10
  };
}

// Determine best reply template based on post content
function selectTemplate(post) {
  const title = post.title.toLowerCase();
  const text = (post.selftext || '').toLowerCase();
  const combined = title + ' ' + text;

  if (combined.includes('swarm') || combined.includes('team') || combined.includes('orchestrat')) {
    return 'swarms';
  }
  if (combined.includes('moltbook') || combined.includes('molt')) {
    return 'moltbook';
  }
  if (combined.includes('trust') || combined.includes('reputation') || combined.includes('scor')) {
    return 'trust';
  }
  if (combined.includes('research') || combined.includes('paper') || combined.includes('arxiv')) {
    return 'research';
  }
  return 'general';
}

// Score opportunity priority
function scoreOpportunity(post, velocity) {
  let score = 0;
  
  // Base score from engagement
  score += Math.min(post.score / 10, 100);
  score += Math.min(post.num_comments, 50);
  
  // Velocity bonus
  score += velocity.scorePerHour * 2;
  score += velocity.commentsPerHour * 5;
  
  // Keyword match bonus
  const combined = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  for (const kw of CONFIG.keywords) {
    if (combined.includes(kw)) score += 15;
  }
  
  // Freshness bonus (prefer 2-12 hour old posts)
  if (velocity.hoursOld >= 2 && velocity.hoursOld <= 12) score += 30;
  
  return Math.round(score);
}

// Mock Reddit fetch (in production, use pushshift or reddit API)
// Since Reddit blocks most scraping, this simulates the structure
// and logs what manual checks should be done
async function fetchRedditPosts(subreddit) {
  console.log(`[RADAR] Would check r/${subreddit} (manual monitoring required)`);
  
  // In production, this would use:
  // - pushshift.io API (if available)
  // - reddit.com/r/{sub}/new.json?limit=25 (with proper headers)
  // - Manual browser check workflow
  
  // Return empty for now - the value is in the framework
  return [];
}

// Check all subreddits
async function checkAllSubreddits() {
  const allPosts = [];
  
  for (const sub of CONFIG.subreddits) {
    try {
      const posts = await fetchRedditPosts(sub);
      allPosts.push(...posts.map(p => ({ ...p, subreddit: sub })));
    } catch (e) {
      console.error(`[RADAR] Error checking r/${sub}:`, e.message);
    }
  }
  
  return allPosts;
}

// Filter and process opportunities
function processOpportunities(posts, existingIds) {
  const opportunities = [];
  
  for (const post of posts) {
    // Skip if already tracked
    if (existingIds.has(post.id)) continue;
    
    // Skip if doesn't meet thresholds
    if (post.score < CONFIG.minScore) continue;
    if (post.num_comments < CONFIG.minComments) continue;
    
    // Check keyword relevance
    const combined = (post.title + ' ' + (post.selftext || '')).toLowerCase();
    const isRelevant = CONFIG.keywords.some(kw => combined.includes(kw));
    if (!isRelevant) continue;
    
    const velocity = calculateVelocity(post);
    const priorityScore = scoreOpportunity(post, velocity);
    const template = selectTemplate(post);
    
    opportunities.push({
      id: post.id,
      subreddit: post.subreddit,
      title: post.title,
      url: `https://reddit.com${post.permalink}`,
      score: post.score,
      comments: post.num_comments,
      velocity,
      priorityScore,
      template,
      suggestedReply: REPLY_TEMPLATES[template],
      created: new Date(post.created_utc * 1000).toISOString(),
      discovered: new Date().toISOString(),
      status: 'new', // new, reviewed, acted, skipped
      notes: ''
    });
  }
  
  // Sort by priority score
  return opportunities.sort((a, b) => b.priorityScore - a.priorityScore);
}

// Generate HTML dashboard
function generateDashboard(data) {
  const newCount = data.opportunities.filter(o => o.status === 'new').length;
  const actedCount = data.opportunities.filter(o => o.status === 'acted').length;
  const highPriority = data.opportunities.filter(o => o.priorityScore >= 150);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reddit Opportunity Radar | MDI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #121212;
      color: #e0e0e0;
      line-height: 1.6;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { 
      color: #5C8CFF; 
      margin-bottom: 10px;
      font-size: 1.8rem;
    }
    .subtitle {
      color: #888;
      margin-bottom: 30px;
      font-size: 0.95rem;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    .stat-box {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      border: 1px solid #333;
    }
    .stat-value {
      font-size: 2rem;
      font-weight: bold;
      color: #5C8CFF;
    }
    .stat-label {
      color: #888;
      font-size: 0.85rem;
      text-transform: uppercase;
    }
    .opportunities {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }
    .opportunity {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      transition: border-color 0.2s;
    }
    .opportunity:hover {
      border-color: #5C8CFF;
    }
    .opportunity.new { border-left: 4px solid #5C8CFF; }
    .opportunity.acted { border-left: 4px solid #4ade80; opacity: 0.7; }
    .opportunity.skipped { border-left: 4px solid #666; opacity: 0.5; }
    .opp-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 10px;
      flex-wrap: wrap;
      gap: 10px;
    }
    .opp-title {
      color: #fff;
      font-weight: 600;
      text-decoration: none;
      font-size: 1.1rem;
    }
    .opp-title:hover { text-decoration: underline; }
    .opp-meta {
      display: flex;
      gap: 15px;
      font-size: 0.85rem;
      color: #888;
      margin-bottom: 15px;
      flex-wrap: wrap;
    }
    .score {
      background: linear-gradient(135deg, #5C8CFF, #C68BF8);
      color: #000;
      padding: 3px 10px;
      border-radius: 12px;
      font-weight: bold;
      font-size: 0.85rem;
    }
    .priority-high { color: #4ade80; font-weight: bold; }
    .priority-medium { color: #fbbf24; }
    .priority-low { color: #888; }
    .template-preview {
      background: #0d0d0d;
      padding: 15px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.85rem;
      color: #aaa;
      margin-top: 10px;
      white-space: pre-wrap;
      max-height: 150px;
      overflow-y: auto;
    }
    .actions {
      margin-top: 15px;
      display: flex;
      gap: 10px;
    }
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.8; }
    .btn-copy {
      background: #5C8CFF;
      color: #000;
    }
    .btn-link {
      background: #333;
      color: #fff;
    }
    .last-check {
      color: #666;
      font-size: 0.85rem;
      margin-top: 30px;
      text-align: center;
    }
    .instructions {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .instructions h2 {
      color: #C68BF8;
      margin-bottom: 10px;
      font-size: 1.1rem;
    }
    .instructions ol {
      margin-left: 20px;
      color: #aaa;
    }
    .instructions li {
      margin-bottom: 8px;
    }
    .no-opps {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }
    .no-opps-icon {
      font-size: 3rem;
      margin-bottom: 15px;
    }
    .status-badge {
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      text-transform: uppercase;
      font-weight: bold;
    }
    .status-new { background: #5C8CFF; color: #000; }
    .status-acted { background: #4ade80; color: #000; }
    .status-skipped { background: #666; color: #fff; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎯 Reddit Opportunity Radar</h1>
    <p class="subtitle">Highest-ROI distribution target (r/ClaudeAI: 1.6K+ engagement on AI agent posts)</p>
    
    <div class="stats">
      <div class="stat-box">
        <div class="stat-value">${data.opportunities.length}</div>
        <div class="stat-label">Total Tracked</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${newCount}</div>
        <div class="stat-label">New Opportunities</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${actedCount}</div>
        <div class="stat-label">Acted On</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${highPriority.length}</div>
        <div class="stat-label">High Priority</div>
      </div>
    </div>
    
    <div class="instructions">
      <h2>📋 How to Use</h2>
      <ol>
        <li>Check r/ClaudeAI, r/artificial manually for AI agent posts (Reddit blocks automation)</li>
        <li>Look for posts with 50+ upvotes and 20+ comments discussing AI agents/collectives</li>
        <li>Copy the suggested reply (customized to post type)</li>
        <li>Paste into Reddit, add context specific to the thread</li>
        <li>Track which posts you acted on by updating the status</li>
      </ol>
    </div>
    
    <div class="opportunities">
      ${data.opportunities.length === 0 ? `
        <div class="no-opps">
          <div class="no-opps-icon">📡</div>
          <p>No opportunities tracked yet.</p>
          <p style="font-size: 0.9rem; margin-top: 10px;">Run the radar manually or wait for scheduled checks.</p>
        </div>
      ` : data.opportunities.map(opp => `
        <div class="opportunity ${opp.status}">
          <div class="opp-header">
            <a href="${opp.url}" target="_blank" class="opp-title">${opp.title}</a>
            <div style="display: flex; gap: 10px; align-items: center;">
              <span class="score">${opp.priorityScore} pts</span>
              <span class="status-badge status-${opp.status}">${opp.status}</span>
            </div>
          </div>
          <div class="opp-meta">
            <span>r/${opp.subreddit}</span>
            <span>↑ ${opp.score}</span>
            <span>💬 ${opp.comments}</span>
            <span class="priority-${opp.priorityScore >= 150 ? 'high' : opp.priorityScore >= 100 ? 'medium' : 'low'}">
              ${opp.velocity.scorePerHour}/hr velocity
            </span>
            <span>Template: ${opp.template}</span>
          </div>
          <div class="template-preview">${opp.suggestedReply}</div>
          <div class="actions">
            <button class="btn btn-copy" onclick="navigator.clipboard.writeText(this.parentElement.previousElementSibling.textContent); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy Reply', 1000)">Copy Reply</button>
            <a href="${opp.url}" target="_blank" class="btn btn-link">Open Thread</a>
          </div>
        </div>
      `).join('')}
    </div>
    
    <p class="last-check">
      Last check: ${data.lastCheck ? new Date(data.lastCheck).toLocaleString() : 'Never'}<br>
      Monitoring: ${CONFIG.subreddits.map(s => 'r/' + s).join(', ')}
    </p>
  </div>
  
  <script>
    // Auto-refresh every 5 minutes
    setTimeout(() => location.reload(), 5 * 60 * 1000);
  </script>
</body>
</html>`;
}

// Main execution
async function main() {
  console.log('🎯 Reddit Opportunity Radar');
  console.log('==========================');
  console.log('');
  
  const data = loadOpportunities();
  
  // Check subreddits (mock for now due to Reddit restrictions)
  const posts = await checkAllSubreddits();
  
  // Process new opportunities
  const existingIds = new Set(data.opportunities.map(o => o.id));
  const newOpportunities = processOpportunities(posts, existingIds);
  
  if (newOpportunities.length > 0) {
    console.log(`[RADAR] Found ${newOpportunities.length} new opportunities`);
    data.opportunities.push(...newOpportunities);
    data.stats.totalFound += newOpportunities.length;
  } else {
    console.log('[RADAR] No new opportunities found');
  }
  
  data.lastCheck = new Date().toISOString();
  
  // Save JSON
  saveOpportunities(data);
  console.log(`[RADAR] Saved to ${CONFIG.opportunitiesFile}`);
  
  // Generate HTML dashboard
  const dashboardHtml = generateDashboard(data);
  const dashboardPath = '/var/www/snap/reddit-radar.html';
  fs.writeFileSync(dashboardPath, dashboardHtml);
  console.log(`[RADAR] Dashboard: ${dashboardPath}`);
  
  // Summary
  console.log('');
  console.log('📊 Summary:');
  console.log(`   Total opportunities: ${data.opportunities.length}`);
  console.log(`   New: ${data.opportunities.filter(o => o.status === 'new').length}`);
  console.log(`   Acted: ${data.opportunities.filter(o => o.status === 'acted').length}`);
  console.log(`   High priority: ${data.opportunities.filter(o => o.priorityScore >= 150).length}`);
  
  // Action items
  const highPriorityNew = data.opportunities.filter(o => o.status === 'new' && o.priorityScore >= 150);
  if (highPriorityNew.length > 0) {
    console.log('');
    console.log('🔥 High-priority opportunities waiting:');
    highPriorityNew.slice(0, 3).forEach(o => {
      console.log(`   - ${o.title.substring(0, 60)}... (${o.priorityScore} pts)`);
    });
  }
  
  console.log('');
  console.log('💡 Manual check recommended: https://reddit.com/r/ClaudeAI/new');
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}

export { REPLY_TEMPLATES, scoreOpportunity, selectTemplate };
