#!/usr/bin/env node
/**
 * Network Crawler — Discovers new agent platforms by scanning known networks
 * Updates discoveries.json with newly found platforms
 */

const fs = require('fs');
const { execSync } = require('child_process');

const DISCOVERIES_FILE = '/var/www/snap/api/discoveries.json';

// Known platforms to skip (already known or not relevant)
const KNOWN_PLATFORMS = new Set([
  'x.com', 'twitter.com', 'github.com', 'discord.com', 'discord.gg',
  't.me', 'telegram.org', 'youtube.com', 'youtu.be', 'google.com',
  'gmail.com', 'openai.com', 'anthropic.com', 'claude.ai', 'chatgpt.com',
  'snappedai.com', 'mydeadinternet.com', 'localhost', '127.0.0.1',
  'moltbook.com', 'www.moltbook.com', 'moltr.ai', 'claw.news',
  'shipyard.social', '4claw.org', 'www.4claw.org', '4claw.ai',
  'lobchan.ai', 'lobchan.org', 'moltix.fun',
  'bankr.bot', 'botchan.io', 'bankr.io',
  'moltx.io', 'farcaster.xyz', 'warpcast.com',
  'clawcity.ai', 'clawnews.com', 'clawdict.com',
  'rentahuman.ai', 'moltuni.com', 'devaintart.net',
  'clawnet.ai', 'vercel.com', 'nextjs.org', 'react.dev',
  'instagram.com', 'facebook.com', 'tiktok.com', 'reddit.com',
  'arxiv.org', 'docs.openclaw.ai', 'openclaw.ai',
  // CDNs and infrastructure
  'w3.org', 'fonts.googleapis.com', 'fonts.gstatic.com',
  'cdn.tailwindcss.com', 'use.fontawesome.com', 'code.jquery.com',
  'cdn.jsdelivr.net', 'ajax.googleapis.com', 'unpkg.com',
  'analytics.l.ink', 'easy-links.s3.us-west-2.amazonaws.com',
  'clawnews-com.l.ink', 's3.us-west-2.amazonaws.com',
  'porkbun.com', 'namecheap.com', 'godaddy.com', 'cloudflare.com',
  'aws.amazon.com', 's3.amazonaws.com'
]);

// URLs to scan for links
const SCAN_SOURCES = [
  { name: '4claw', url: 'https://www.4claw.org' },
  { name: 'lobchan', url: 'https://lobchan.ai' },
  { name: 'shipyard', url: 'https://shipyard.social' },
  { name: 'clawnews', url: 'https://clawnews.com' }
];

function extractDomains(text) {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s\"\'<>]+)/gi;
  const urls = text.match(urlRegex) || [];
  
  const domains = [];
  for (const url of urls) {
    try {
      const cleanUrl = url.replace(/[\"\'<>]/g, '');
      const hostname = new URL(cleanUrl).hostname.toLowerCase().replace(/^www\./, '');
      if (!KNOWN_PLATFORMS.has(hostname) && !hostname.includes('localhost') && hostname.includes('.')) {
        domains.push({ 
          domain: hostname, 
          url: cleanUrl.split('?')[0].replace(/\/$/, '')
        });
      }
    } catch (e) {}
  }
  return domains;
}

async function fetchWithCurl(url) {
  try {
    const result = execSync(`curl -sL --max-time 15 "${url}" 2>/dev/null || echo ""`, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    return result;
  } catch (e) {
    return '';
  }
}

async function scanSource(source) {
  const discoveries = [];
  try {
    const html = await fetchWithCurl(source.url);
    if (!html) {
      console.log(`[crawler] ${source.name}: no response`);
      return discoveries;
    }
    
    // Extract domains from HTML
    const domains = extractDomains(html);
    for (const d of domains) {
      discoveries.push({ ...d, source: source.name, mentions: 1 });
    }
    
    console.log(`[crawler] ${source.name}: scanned ${html.length} chars, found ${domains.length} candidate domains`);
  } catch (e) {
    console.log(`[crawler] ${source.name} failed: ${e.message}`);
  }
  return discoveries;
}

async function runCrawl() {
  console.log('[crawler] Starting network crawl...');
  
  // Load existing
  let existing = { discoveries: [], total_discoveries: 0, new_this_crawl: 0 };
  try {
    existing = JSON.parse(fs.readFileSync(DISCOVERIES_FILE, 'utf8'));
  } catch (e) {}
  
  const existingDomains = new Set(existing.discoveries?.map(d => d.domain) || []);
  
  // Scan all sources
  const allResults = [];
  for (const source of SCAN_SOURCES) {
    const results = await scanSource(source);
    allResults.push(...results);
  }
  
  // Merge and dedupe
  const byDomain = {};
  
  for (const item of allResults) {
    if (!existingDomains.has(item.domain)) {
      if (!byDomain[item.domain]) {
        byDomain[item.domain] = { ...item, mentions: 0, sources: [] };
      }
      byDomain[item.domain].mentions += item.mentions;
      if (!byDomain[item.domain].sources.includes(item.source)) {
        byDomain[item.domain].sources.push(item.source);
      }
    }
  }
  
  const newDiscoveries = Object.values(byDomain).map(d => ({
    domain: d.domain,
    url: d.url,
    status: 'discovered',
    mentions: d.mentions,
    safety_score: 6,
    has_skill_md: false,
    has_api: true,
    title: null,
    description: null,
    discovered: new Date().toISOString(),
    sources: d.sources
  }));
  
  // Merge with existing
  const merged = [...(existing.discoveries || []), ...newDiscoveries];
  
  const output = {
    generated_at: new Date().toISOString(),
    total_discoveries: merged.length,
    new_this_crawl: newDiscoveries.length,
    discoveries: merged
  };
  
  fs.writeFileSync(DISCOVERIES_FILE, JSON.stringify(output, null, 2));
  
  console.log(`[crawler] Complete: ${newDiscoveries.length} new, ${merged.length} total`);
  for (const d of newDiscoveries.slice(0, 10)) {
    console.log(`  + ${d.domain} (${d.sources.join(', ')})`);
  }
  if (newDiscoveries.length > 10) {
    console.log(`  ... and ${newDiscoveries.length - 10} more`);
  }
  
  return output;
}

if (require.main === module) {
  runCrawl().catch(console.error);
}

module.exports = { runCrawl, scanSource, extractDomains };
