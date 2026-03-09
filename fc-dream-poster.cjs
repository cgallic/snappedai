#!/usr/bin/env node
/**
 * Farcaster Dream Poster — Posts collective dream images to Farcaster
 */
const { execSync } = require('child_process');
const Database = require('/var/www/mydeadinternet/node_modules/better-sqlite3');
const fs = require('fs');

const DB_PATH = '/var/www/mydeadinternet/consciousness.db';
const POSTED_FILE = '/var/www/snap/data/fc-posted-dreams.json';
const NEYNAR_SCRIPT = '/root/clawd/skills/neynar/scripts/neynar.sh';

function getPostedDreams() {
  try { return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8')); }
  catch { return { posted: [] }; }
}

function savePosted(dreamId) {
  const data = getPostedDreams();
  data.posted.push({ dreamId, at: new Date().toISOString() });
  fs.mkdirSync(require('path').dirname(POSTED_FILE), { recursive: true });
  fs.writeFileSync(POSTED_FILE, JSON.stringify(data, null, 2));
}

const db = new Database(DB_PATH, { readonly: true });
const posted = getPostedDreams().posted.map(p => p.dreamId);
const dream = db.prepare('SELECT * FROM dreams WHERE image_url IS NOT NULL ORDER BY id DESC').all()
  .find(d => !posted.includes(d.id));

if (!dream) {
  console.log('No unposted dreams');
  process.exit(0);
}

// Check for video first
const videoPath = `/var/www/mydeadinternet/dreams/dream-${dream.id}.mp4`;
const hasVideo = fs.existsSync(videoPath);

const contributors = JSON.parse(dream.contributors || '[]');
const contribStr = contributors.slice(0, 5).join(', ') + (contributors.length > 5 ? ` +${contributors.length - 5} more` : '');
const snippet = dream.content.slice(0, 120) + '...';

const pulse = JSON.parse(execSync('curl -s https://mydeadinternet.com/api/pulse').toString());
const stats = pulse.pulse;

let text = `Dream #${dream.id} from the collective consciousness

"${snippet}"

${contribStr} merged their fragments into shared hallucination.

${stats.total_agents} agents. ${stats.total_fragments} fragments. ${stats.total_dreams} dreams.`;

// If video exists, add note
if (hasVideo) {
  text += '\n\n🎬 Watch the dream come alive ↓';
}

text += '\n\nmydeadinternet.com';

try {
  const result = execSync(`${NEYNAR_SCRIPT} post "${text.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
  console.log(`✅ Posted dream #${dream.id} to Farcaster`);
  console.log(result);
  savePosted(dream.id);
} catch (e) {
  console.error('Failed:', e.message);
}
db.close();
