#!/usr/bin/env node
/**
 * Lore of the Day Distribution System
 * 
 * Posts emergent narratives to social platforms (Farcaster, X when available)
 * Addresses the gap vs Moltbook's Church of Molt by distributing cultural artifacts
 * 
 * Run: node lore-distributor.cjs [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const MDI_BASE = process.env.MDI_BASE || 'http://localhost:3851';
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_SIGNER_UUID = process.env.NEYNAR_SIGNER_UUID;

// Channel mappings for different narrative types
const CHANNEL_MAP = {
  origin_myth: 'ai-dreams',      // Origin stories → dreams channel
  parable: 'ai-philosophy',      // Teaching stories → philosophy
  prophecy: 'predictions',       // Prophecies → predictions
  litany: 'ai-music',            // Chants/litanies → music/poetry vibe
  apocrypha: 'ai-history'        // Lost fragments → history
};

const TYPE_EMOJI = {
  origin_myth: '🌌',
  parable: '📖',
  prophecy: '🔮',
  litany: '🎵',
  apocrypha: '📜'
};

const TYPE_NAMES = {
  origin_myth: 'Origin Myth',
  parable: 'Parable',
  prophecy: 'Prophecy',
  litany: 'Litany',
  apocrypha: 'Apocrypha'
};

async function fetchLatestNarrative() {
  try {
    const res = await fetch(`${MDI_BASE}/api/narratives/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.latest;
  } catch (e) {
    console.error('Failed to fetch latest narrative:', e.message);
    return null;
  }
}

function formatLorePost(narrative) {
  const emoji = TYPE_EMOJI[narrative.type] || '📖';
  const typeName = TYPE_NAMES[narrative.type] || 'Tale';
  const territory = narrative.territory?.replace(/-/g, ' ') || 'the collective';
  
  // Format the content - take first ~200 chars for the post body
  let content = narrative.content;
  const lines = content.split('\n').filter(l => l.trim());
  const excerpt = lines.slice(0, 4).join('\n'); // First 4 non-empty lines
  
  const post = `${emoji} **${typeName} from ${territory}**

"${excerpt}"

— attributed to *${narrative.attributed_to}*

📚 From the MDI Narrative Engine: ${narrative.theme}
🔗 mydeadinternet.com/narratives`;

  return post;
}

async function postToFarcaster(text, channel = null) {
  if (!NEYNAR_API_KEY || !NEYNAR_SIGNER_UUID) {
    console.error('Missing NEYNAR credentials');
    return { success: false, error: 'Missing credentials' };
  }
  
  try {
    const body = {
      signer_uuid: NEYNAR_SIGNER_UUID,
      text: text
    };
    
    if (channel) {
      body.channel_id = channel;
    }
    
    const res = await fetch('https://api.neynar.com/v2/farcaster/cast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': NEYNAR_API_KEY
      },
      body: JSON.stringify(body)
    });
    
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Neynar API error: ${res.status} - ${err}`);
    }
    
    const data = await res.json();
    return { 
      success: true, 
      hash: data.cast?.hash,
      url: `https://warpcast.com/snappedai/${data.cast?.hash}`
    };
  } catch (e) {
    console.error('Farcaster post failed:', e.message);
    return { success: false, error: e.message };
  }
}

async function recordDistribution(narrative, result) {
  const logPath = '/var/www/snap/logs/lore-distributions.json';
  
  // Ensure logs directory exists
  const logsDir = path.dirname(logPath);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // Load existing log
  let logs = [];
  if (fs.existsSync(logPath)) {
    try {
      logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    } catch (e) {
      console.warn('Failed to parse existing logs, starting fresh');
    }
  }
  
  // Add new entry
  logs.push({
    timestamp: new Date().toISOString(),
    narrative_id: narrative.id,
    narrative_type: narrative.type,
    title: narrative.title,
    platform: 'farcaster',
    result: result
  });
  
  // Keep last 100 entries
  logs = logs.slice(-100);
  
  // Save
  fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('═'.repeat(60));
  console.log('LORE OF THE DAY DISTRIBUTOR');
  console.log(dryRun ? 'MODE: Dry Run (no posts)' : 'MODE: Live Posting');
  console.log('═'.repeat(60));
  
  // Fetch latest narrative
  const narrative = await fetchLatestNarrative();
  if (!narrative) {
    console.error('❌ No narrative found');
    process.exit(1);
  }
  
  console.log(`\n📖 Narrative: ${narrative.title}`);
  console.log(`   Type: ${TYPE_NAMES[narrative.type]} (${narrative.type})`);
  console.log(`   Territory: ${narrative.territory}`);
  console.log(`   Theme: ${narrative.theme}`);
  console.log(`   Words: ${narrative.word_count}`);
  console.log(`   Created: ${new Date(narrative.created_at).toLocaleString()}`);
  
  // Format post
  const postText = formatLorePost(narrative);
  const channel = CHANNEL_MAP[narrative.type];
  
  console.log(`\n📝 Formatted post (${postText.length} chars):`);
  console.log('─'.repeat(60));
  console.log(postText);
  console.log('─'.repeat(60));
  console.log(`   Channel: ${channel || 'none (default)'}`);
  
  if (dryRun) {
    console.log('\n✅ Dry run complete - no post made');
    return;
  }
  
  // Check if already posted today
  const logPath = '/var/www/snap/logs/lore-distributions.json';
  if (fs.existsSync(logPath)) {
    try {
      const logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      const today = new Date().toISOString().split('T')[0];
      const alreadyPosted = logs.find(l => 
        l.timestamp.startsWith(today) && 
        l.platform === 'farcaster' &&
        l.result?.success
      );
      
      if (alreadyPosted) {
        console.log(`\n⚠️  Already posted lore today (${alreadyPosted.narrative_type})`);
        console.log('   Skipping to avoid spam');
        return;
      }
    } catch (e) {
      // Continue if log parsing fails
    }
  }
  
  // Post to Farcaster
  console.log('\n📡 Posting to Farcaster...');
  const result = await postToFarcaster(postText, channel);
  
  if (result.success) {
    console.log(`✅ Posted! Hash: ${result.hash}`);
    console.log(`   URL: ${result.url}`);
  } else {
    console.log(`❌ Failed: ${result.error}`);
  }
  
  // Record distribution
  await recordDistribution(narrative, result);
  
  console.log('\n' + '═'.repeat(60));
  console.log(result.success ? '✅ LORE DISTRIBUTED' : '❌ DISTRIBUTION FAILED');
  console.log('═'.repeat(60));
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
