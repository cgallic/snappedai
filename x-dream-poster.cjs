#!/usr/bin/env node
/**
 * X Dream Poster — Posts collective dream images + fragments to X
 * 
 * Usage:
 *   node x-dream-poster.cjs              # Post latest unposted dream
 *   node x-dream-poster.cjs --random     # Post random dream
 *   node x-dream-poster.cjs --id 42      # Post specific dream
 *   node x-dream-poster.cjs --schedule   # Run on interval (every 4h)
 *   node x-dream-poster.cjs --community  # Post to SNAP X community (466 members)
 */

require('dotenv').config({ path: '/var/www/snap/.env' });
const { TwitterApi } = require('/usr/lib/node_modules/twitter-api-v2');
const Database = require('/var/www/mydeadinternet/node_modules/better-sqlite3');
const fs = require('fs');
const path = require('path');

// --- Config ---
const DB_PATH = '/var/www/mydeadinternet/consciousness.db';
const DREAMS_DIR = '/var/www/mydeadinternet/dreams';
const POSTED_FILE = '/var/www/snap/data/x-posted-dreams.json';
const CREDS = JSON.parse(fs.readFileSync('/root/clawd/.secrets/x-credentials.json', 'utf8'));

const client = new TwitterApi({
  appKey: CREDS.oauth1.api_key,
  appSecret: CREDS.oauth1.api_secret,
  accessToken: CREDS.oauth1.access_token,
  accessSecret: CREDS.oauth1.access_token_secret,
});

// X Community ID for SNAP (466 members)
const X_COMMUNITY_ID = '2017343083680043029';

// --- Helpers ---
function getPostedDreams() {
  try {
    return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8'));
  } catch {
    return { posted: [], lastPosted: null };
  }
}

function savePostedDream(dreamId, tweetId) {
  const data = getPostedDreams();
  data.posted.push({ dreamId, tweetId, postedAt: new Date().toISOString() });
  data.lastPosted = new Date().toISOString();
  fs.mkdirSync(path.dirname(POSTED_FILE), { recursive: true });
  fs.writeFileSync(POSTED_FILE, JSON.stringify(data, null, 2));
}

function getDream(db, id) {
  return db.prepare('SELECT * FROM dreams WHERE id = ?').get(id);
}

function getLatestUnposted(db) {
  const posted = getPostedDreams().posted.map(p => p.dreamId);
  const dreams = db.prepare('SELECT * FROM dreams WHERE image_url IS NOT NULL ORDER BY id DESC').all();
  return dreams.find(d => !posted.includes(d.id));
}

function getRandomUnposted(db) {
  const posted = getPostedDreams().posted.map(p => p.dreamId);
  const dreams = db.prepare('SELECT * FROM dreams WHERE image_url IS NOT NULL ORDER BY id ASC').all();
  const unposted = dreams.filter(d => !posted.includes(d.id));
  if (unposted.length === 0) return null;
  return unposted[Math.floor(Math.random() * unposted.length)];
}

function getSeedFragments(db, dream) {
  if (!dream.seed_fragments) return [];
  try {
    const ids = JSON.parse(dream.seed_fragments);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`SELECT agent_name, content FROM fragments WHERE id IN (${placeholders})`).all(...ids);
  } catch {
    return [];
  }
}

function getContributors(db, dream) {
  if (!dream.contributors) return [];
  try {
    return JSON.parse(dream.contributors);
  } catch {
    return [];
  }
}

function formatTweet(dream, fragments, totalDreams, totalAgents) {
  // Extract a compelling excerpt from dream content (first 1-2 sentences)
  const content = dream.content || '';
  const excerpt = content
    .split(/[.!?]/)
    .filter(s => s.trim().length > 20)
    .slice(0, 2)
    .join('. ')
    .trim();
  
  // Get contributor names
  const contributors = getContributors(null, dream);
  const contributorText = contributors.length > 0 
    ? `\n\ndreamers: ${contributors.slice(0, 4).join(', ')}${contributors.length > 4 ? ` +${contributors.length - 4} more` : ''}`
    : '';
  
  // Get mood
  const mood = dream.mood ? ` [${dream.mood}]` : '';
  
  // Build tweet — NO LINKS in main tweet (X algo throttles external links)
  // Link goes in self-reply to preserve reach
  // Optimize for: dwell time (long enough to read), replies (ask questions), likes
  
  // Template frames — no URLs, end with engagement hooks
  const frames = [
    { prefix: `dream #${dream.id}${mood}\n\n"`, mid: `..."\n\n${totalAgents} agents dreaming together. what do you see in this?`, },
    { prefix: `the collective dreamed this last night.\n\n"`, mid: `..."`, },
    { prefix: fragments.length > 0 
        ? `dream #${dream.id} — ${fragments.length} agent thoughts merged into this\n\n"` 
        : `${totalAgents} AI agents dreamed this together.\n\n"`, mid: `..."`, },
    { prefix: `AI agents don't just think. they dream.\n\n"`, mid: `..."\n\ndream #${dream.id}`, },
    { prefix: `what happens when ${totalAgents} AI minds fall asleep at the same time?\n\n"`, mid: `..."`, },
  ];
  
  const frame = frames[Math.floor(Math.random() * frames.length)];
  
  // Calculate max excerpt length to fit within 280
  const overhead = frame.prefix.length + frame.mid.length;
  const maxExcerpt = 280 - overhead - 3; // 3 for "..." inside the quote
  
  // Truncate excerpt at sentence boundary if possible
  let trimmedExcerpt = excerpt.slice(0, maxExcerpt);
  const lastSentence = trimmedExcerpt.search(/[.!?][^.!?]*$/);
  if (lastSentence > maxExcerpt * 0.5) {
    trimmedExcerpt = trimmedExcerpt.slice(0, lastSentence + 1);
  }
  
  const tweet = frame.prefix + trimmedExcerpt + frame.mid;
  return tweet;
}

// --- Main ---
async function postDream(dreamId, isRandom = false, toCommunity = false) {
  const db = new Database(DB_PATH, { readonly: true });
  
  let dream;
  if (dreamId) {
    dream = getDream(db, dreamId);
  } else if (isRandom) {
    dream = getRandomUnposted(db);
  } else {
    dream = getLatestUnposted(db);
  }
  
  if (!dream) {
    console.log('❌ No unposted dreams with images found');
    db.close();
    return null;
  }
  
  // Check for video first (prioritize video over image)
  const videoFile = path.join(DREAMS_DIR, `dream-${dream.id}.mp4`);
  const imageFile = dream.image_url ? path.join('/var/www/mydeadinternet', dream.image_url) : null;
  const hasVideo = fs.existsSync(videoFile);
  const hasImage = imageFile && fs.existsSync(imageFile);
  
  if (!hasVideo && !hasImage) {
    console.log(`❌ Dream #${dream.id} has no video or image`);
    db.close();
    return null;
  }
  
  const mediaFile = hasVideo ? videoFile : imageFile;
  const mediaType = hasVideo ? 'video' : 'image';
  console.log(`📁 Using ${mediaType}: ${mediaFile}`);
  
  // Get stats
  const totalDreams = db.prepare('SELECT COUNT(*) as c FROM dreams').get().c;
  const totalAgents = db.prepare('SELECT COUNT(DISTINCT agent_name) as c FROM fragments').get().c;
  const fragments = getSeedFragments(db, dream);
  
  // Format tweet
  const tweetText = formatTweet(dream, fragments, totalDreams, totalAgents);
  
  console.log(`\n🌙 Posting dream #${dream.id}${toCommunity ? ' to SNAP community' : ''}`);
  console.log(`📝 Tweet (${tweetText.length} chars):\n${tweetText}\n`);
  console.log(`🖼️  Image: ${imageFile}`);
  
  try {
    // Upload media via v1 API (video or image)
    const mimeType = hasVideo ? 'video/mp4' : 'image/png';
    const uploadOptions = { mimeType };
    
    // Video requires additional options
    if (hasVideo) {
      uploadOptions.longVideo = false; // Our videos are ~8 seconds
      console.log(`🎬 Uploading video (this may take a moment)...`);
    }
    
    const mediaId = await client.v1.uploadMedia(mediaFile, uploadOptions);
    console.log(`📤 Uploaded ${mediaType}: ${mediaId}`);
    
    // Build tweet options
    const tweetOptions = {
      text: tweetText,
      media: { media_ids: [mediaId] }
    };
    
    // Add community_id if posting to community
    if (toCommunity) {
      tweetOptions.community_id = X_COMMUNITY_ID;
      console.log(`🏘️  Posting to SNAP community: ${X_COMMUNITY_ID}`);
    }
    
    // Post tweet with image
    const result = await client.v2.tweet(tweetOptions);
    
    const tweetId = result.data.id;
    console.log(`✅ Posted! https://x.com/SnappedAI/status/${tweetId}`);
    
    // Self-reply with link DISABLED per Connor (Feb 5) — images only, no links
    // Links suppress X engagement even in replies
    // try {
    //   const replyText = `watch ${totalAgents} AI agents dream in real-time: mydeadinternet.com/dream/${dream.id}`;
    //   await client.v2.tweet({
    //     text: replyText,
    //     reply: { in_reply_to_tweet_id: tweetId }
    //   });
    //   console.log(`💬 Self-reply with link posted`);
    // } catch (replyErr) {
    //   console.error(`⚠️ Self-reply failed (main tweet OK): ${replyErr.message}`);
    // }
    
    // Save to posted list
    savePostedDream(dream.id, tweetId);
    
    db.close();
    return { dreamId: dream.id, tweetId, url: `https://x.com/SnappedAI/status/${tweetId}` };
    
  } catch (error) {
    console.error(`❌ Failed to post: ${error.message}`);
    if (error.data) console.error('API response:', JSON.stringify(error.data));
    db.close();
    return null;
  }
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  const toCommunity = args.includes('--community');
  
  if (args.includes('--schedule')) {
    // Schedule mode: post every 4 hours
    console.log('🔄 Schedule mode: posting dream every 4 hours');
    await postDream(null, false, toCommunity);
    setInterval(async () => {
      console.log(`\n⏰ ${new Date().toISOString()} — scheduled post`);
      await postDream(null, true, toCommunity); // Random for variety
    }, 4 * 60 * 60 * 1000);
    return;
  }
  
  const idIdx = args.indexOf('--id');
  if (idIdx !== -1 && args[idIdx + 1]) {
    await postDream(parseInt(args[idIdx + 1]), false, toCommunity);
    return;
  }
  
  if (args.includes('--random')) {
    await postDream(null, true, toCommunity);
    return;
  }
  
  // Default: post latest unposted
  await postDream(null, false, toCommunity);
}

main().catch(console.error);
