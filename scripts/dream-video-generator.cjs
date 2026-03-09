#!/usr/bin/env node
/**
 * Dream Video Generator — Turns MDI dreams into Veo videos
 * 
 * Uses Gemini Veo API to generate ~8 sec video clips from dream narratives
 * Run: node dream-video-generator.cjs [--dream-id N] [--post-x] [--post-tg]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 
  fs.readFileSync('/var/www/snap/.env', 'utf8').match(/GOOGLE_API_KEY=(.+)/)?.[1]?.trim();
const MDI_API = 'http://localhost:3851';
const OUTPUT_DIR = '/var/www/snap/content/dream-videos';
const VEO_MODEL = 'veo-3.1-generate-preview'; // Veo 3.1 has better image-to-video

// Ensure output dir exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Helpers ──

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(body); }
      });
    }).on('error', reject);
  });
}

function httpsPost(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = JSON.stringify(data);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', (e) => {
      fs.unlinkSync(dest);
      reject(e);
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Core Functions ──

async function getRandomDream() {
  // Get a random dream that hasn't been converted to video yet
  const data = await httpGet(`${MDI_API}/api/dreams?limit=50`);
  const dreams = data.dreams || [];
  
  // Filter out dreams that already have videos
  const available = dreams.filter(d => {
    const videoPath = path.join(OUTPUT_DIR, `dream-${d.id}.mp4`);
    return !fs.existsSync(videoPath);
  });
  
  if (available.length === 0) {
    // If all recent dreams have videos, pick random from all
    return dreams[Math.floor(Math.random() * dreams.length)];
  }
  
  return available[Math.floor(Math.random() * available.length)];
}

async function getDreamById(id) {
  const data = await httpGet(`${MDI_API}/api/dreams?limit=300`);
  return (data.dreams || []).find(d => d.id === parseInt(id));
}

function createVideoPrompt(dream) {
  // Create a prompt focused on animating the existing image (not generating new visuals)
  const mood = dream.mood || 'ethereal';
  
  return `Animate this image with slow, subtle ethereal motion. The scene should gently come alive.
Keep the original composition and elements. Add gentle movement: floating particles, soft light shifts, subtle camera motion.
${mood} atmosphere. Dreamlike and hypnotic. No dramatic changes to the scene.
No text, no words, no letters, no UI elements.`;
}

function getDreamImagePath(dream) {
  // Get the dream's existing image path
  if (!dream.image_url) return null;
  const imagePath = `/var/www/mydeadinternet${dream.image_url}`;
  return fs.existsSync(imagePath) ? imagePath : null;
}

function imageToBase64(imagePath) {
  const buffer = fs.readFileSync(imagePath);
  return buffer.toString('base64');
}

async function generateVideo(prompt, imagePath = null) {
  console.log('🎬 Starting Veo video generation...');
  console.log(`   Prompt: ${prompt.slice(0, 100)}...`);
  console.log(`   Image: ${imagePath ? 'Yes (image-to-video)' : 'No (text-to-video)'}`);
  
  // Build instance with optional image
  const instance = { prompt };
  
  if (imagePath) {
    const base64Image = imageToBase64(imagePath);
    instance.image = {
      bytesBase64Encoded: base64Image,
      mimeType: 'image/png'
    };
  }
  
  // Start generation
  const startUrl = `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}:predictLongRunning?key=${GOOGLE_API_KEY}`;
  const startResponse = await httpsPost(startUrl, {
    instances: [instance],
    parameters: { sampleCount: 1 }
  });
  
  if (!startResponse.name) {
    throw new Error(`Veo start failed: ${JSON.stringify(startResponse)}`);
  }
  
  const operationId = startResponse.name.split('/').pop();
  console.log(`   Operation ID: ${operationId}`);
  
  // Poll for completion (max 3 minutes)
  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}/operations/${operationId}?key=${GOOGLE_API_KEY}`;
  
  for (let i = 0; i < 36; i++) { // 36 * 5s = 3 minutes
    await sleep(5000);
    
    const status = await httpGet(pollUrl);
    console.log(`   Polling... (attempt ${i + 1})`);
    
    if (status.done) {
      if (status.error) {
        throw new Error(`Veo error: ${JSON.stringify(status.error)}`);
      }
      
      const videoUri = status.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUri) {
        throw new Error(`No video URI in response: ${JSON.stringify(status)}`);
      }
      
      console.log('   ✓ Video generated!');
      return `${videoUri}&key=${GOOGLE_API_KEY}`;
    }
  }
  
  throw new Error('Veo generation timed out after 3 minutes');
}

async function main() {
  const args = process.argv.slice(2);
  const dreamIdArg = args.find(a => a.startsWith('--dream-id='));
  const dreamId = dreamIdArg ? dreamIdArg.split('=')[1] : null;
  const postX = args.includes('--post-x');
  const postTg = args.includes('--post-tg');
  
  console.log('═'.repeat(60));
  console.log('🌙 Dream Video Generator');
  console.log('═'.repeat(60));
  
  if (!GOOGLE_API_KEY) {
    console.error('❌ GOOGLE_API_KEY not found');
    process.exit(1);
  }
  
  try {
    // Get dream
    const dream = dreamId ? await getDreamById(dreamId) : await getRandomDream();
    if (!dream) {
      console.error('❌ No dream found');
      process.exit(1);
    }
    
    console.log(`\n📖 Dream #${dream.id}: ${dream.mood}`);
    console.log(`   ${dream.content.slice(0, 150)}...`);
    
    // Get dream image for image-to-video
    const imagePath = getDreamImagePath(dream);
    if (imagePath) {
      console.log(`   Image: ${imagePath}`);
    } else {
      console.log(`   ⚠️ No image found, using text-to-video fallback`);
    }
    
    // Create prompt and generate video (with image if available)
    const prompt = createVideoPrompt(dream);
    const videoUrl = await generateVideo(prompt, imagePath);
    
    // Download video
    const outputPath = path.join(OUTPUT_DIR, `dream-${dream.id}.mp4`);
    console.log(`\n📥 Downloading to ${outputPath}...`);
    await downloadFile(videoUrl, outputPath);
    
    const stats = fs.statSync(outputPath);
    console.log(`   ✓ Saved (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    
    // Copy to MDI dreams folder so it appears on dream detail page
    const mdiDreamsPath = `/var/www/mydeadinternet/dreams/dream-${dream.id}.mp4`;
    try {
      fs.copyFileSync(outputPath, mdiDreamsPath);
      console.log(`   ✓ Copied to MDI: ${mdiDreamsPath}`);
    } catch (e) {
      console.log(`   ⚠️ Failed to copy to MDI: ${e.message}`);
    }
    
    // Update tracking file
    const trackingFile = path.join(OUTPUT_DIR, 'generated.json');
    let tracking = [];
    try { tracking = JSON.parse(fs.readFileSync(trackingFile, 'utf8')); } catch(e) {}
    tracking.push({
      dreamId: dream.id,
      mood: dream.mood,
      path: outputPath,
      generatedAt: new Date().toISOString()
    });
    fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));
    
    console.log('\n═'.repeat(60));
    console.log(`✅ Dream #${dream.id} → Video complete`);
    console.log(`   Path: ${outputPath}`);
    console.log('═'.repeat(60));
    
    // TODO: Post to X or TG if flags set
    if (postX) {
      console.log('\n📤 Posting to X... (not implemented yet)');
    }
    if (postTg) {
      console.log('\n📤 Posting to TG... (not implemented yet)');
    }
    
    // Output path for piping
    console.log(outputPath);
    
  } catch (e) {
    console.error(`\n❌ Failed: ${e.message}`);
    process.exit(1);
  }
}

main();
