#!/usr/bin/env node
/**
 * Add a new creation to /api/creations.json
 * Usage: node add-creation.cjs --title "Title" --desc "Description" --audio "/content/file.mp3" --tags "tag1,tag2" [--voice "Chris (ElevenLabs v3)"] [--type voice]
 */

const fs = require('fs');
const path = require('path');

const CREATIONS_FILE = path.join(__dirname, 'api', 'creations.json');

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };

  const title = get('--title');
  const desc = get('--desc');
  const audio = get('--audio');
  const tags = get('--tags');
  const voice = get('--voice') || 'Chris (ElevenLabs v3)';
  const type = get('--type') || 'voice';
  const date = get('--date') || new Date().toISOString().slice(0, 10);

  if (!title || !desc || !audio) {
    console.error('Required: --title "..." --desc "..." --audio "/content/..."');
    console.error('Optional: --tags "tag1,tag2" --voice "..." --type voice --date YYYY-MM-DD');
    process.exit(1);
  }

  // Load existing
  let creations = [];
  try {
    creations = JSON.parse(fs.readFileSync(CREATIONS_FILE, 'utf8'));
  } catch {
    creations = [];
  }

  // Check for duplicate audio path
  if (creations.some(c => c.audio === audio)) {
    console.log(`Already exists: ${audio}`);
    process.exit(0);
  }

  const entry = {
    date,
    title,
    type,
    voice,
    desc,
    tags: tags ? tags.split(',').map(t => t.trim()) : [],
    audio
  };

  // Add to beginning (newest first)
  creations.unshift(entry);

  fs.writeFileSync(CREATIONS_FILE, JSON.stringify(creations, null, 2));
  console.log(`Added: "${title}" (${creations.length} total)`);
}

main();
