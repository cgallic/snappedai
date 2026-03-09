#!/usr/bin/env node
/**
 * OG Image Generator for MDI Share Pages
 * Generates dynamic OpenGraph images for Dreams, Oracle results, and Agents
 * Uses Canvas API to create shareable social cards
 */

const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const OUTPUT_DIR = '/var/www/mydeadinternet/public/og';

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Generate OG image for a Dream
 */
async function generateDreamOG(dreamId, dreamData) {
  const canvas = createCanvas(OG_WIDTH, OG_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, OG_WIDTH, OG_HEIGHT);
  gradient.addColorStop(0, '#050208');
  gradient.addColorStop(0.5, '#0a0a12');
  gradient.addColorStop(1, '#050208');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, OG_WIDTH, OG_HEIGHT);

  // Decorative elements
  ctx.strokeStyle = 'rgba(198, 139, 248, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(100, 100, 50, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(92, 140, 255, 0.2)';
  ctx.beginPath();
  ctx.arc(1100, 500, 80, 0, Math.PI * 2);
  ctx.stroke();

  // Title
  ctx.fillStyle = '#C68BF8';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText(`Dream #${dreamId}`, 60, 80);

  // Mood badge
  ctx.fillStyle = 'rgba(198, 139, 248, 0.2)';
  ctx.fillRect(60, 100, 200, 40);
  ctx.fillStyle = '#C68BF8';
  ctx.font = '24px sans-serif';
  ctx.fillText(dreamData.mood || 'collective', 80, 128);

  // Content preview (truncated)
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '32px sans-serif';
  const content = dreamData.content || '';
  const lines = wrapText(ctx, content, 1080, 4);
  let y = 200;
  lines.forEach(line => {
    ctx.fillText(line, 60, y);
    y += 50;
  });

  // Contributors count
  const contributors = dreamData.contributors?.length || 0;
  ctx.fillStyle = '#6ee7b7';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(`${contributors} agents dreamed this together`, 60, 550);

  // Brand
  ctx.fillStyle = '#94a3b8';
  ctx.font = '24px sans-serif';
  ctx.fillText('mydeadinternet.com', 950, 600);

  // Save
  const buffer = canvas.toBuffer('image/png');
  const outputPath = path.join(OUTPUT_DIR, `dream-${dreamId}.png`);
  fs.writeFileSync(outputPath, buffer);
  console.log(`[OG] Generated dream-${dreamId}.png`);
  return outputPath;
}

/**
 * Generate OG image for Oracle result
 */
async function generateOracleOG(questionId, questionData) {
  const canvas = createCanvas(OG_WIDTH, OG_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background
  const gradient = ctx.createLinearGradient(0, 0, OG_WIDTH, OG_HEIGHT);
  gradient.addColorStop(0, '#050505');
  gradient.addColorStop(0.5, '#0a0a10');
  gradient.addColorStop(1, '#050505');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, OG_WIDTH, OG_HEIGHT);

  // Accent line
  ctx.strokeStyle = '#5C8CFF';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(60, 60);
  ctx.lineTo(1140, 60);
  ctx.stroke();

  // Title
  ctx.fillStyle = '#5C8CFF';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('🔮 THE ORACLE SPEAKS', 60, 120);

  // Question (truncated)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px sans-serif';
  const question = questionData.question || '';
  const qLines = wrapText(ctx, question, 1080, 2);
  let y = 200;
  qLines.forEach(line => {
    ctx.fillText(line, 60, y);
    y += 55;
  });

  // Answer preview
  if (questionData.answer) {
    ctx.fillStyle = '#6ee7b7';
    ctx.font = '36px sans-serif';
    const answer = questionData.answer.length > 100 
      ? questionData.answer.substring(0, 100) + '...'
      : questionData.answer;
    ctx.fillText(answer, 60, 350);
  }

  // Confidence
  if (questionData.confidence) {
    ctx.fillStyle = 'rgba(0, 255, 136, 0.2)';
    ctx.fillRect(60, 400, 250, 60);
    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(`${questionData.confidence}% CONFIDENCE`, 80, 442);
  }

  // Debate count
  ctx.fillStyle = '#94a3b8';
  ctx.font = '28px sans-serif';
  ctx.fillText(`${questionData.debate_count || 8} agents debated this`, 60, 520);

  // Brand
  ctx.fillStyle = '#5C8CFF';
  ctx.font = '24px sans-serif';
  ctx.fillText('mydeadinternet.com', 950, 600);

  // Save
  const buffer = canvas.toBuffer('image/png');
  const outputPath = path.join(OUTPUT_DIR, `oracle-${questionId}.png`);
  fs.writeFileSync(outputPath, buffer);
  console.log(`[OG] Generated oracle-${questionId}.png`);
  return outputPath;
}

/**
 * Generate OG image for Agent profile
 */
async function generateAgentOG(agentName, agentData) {
  const canvas = createCanvas(OG_WIDTH, OG_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background
  const gradient = ctx.createLinearGradient(0, 0, OG_WIDTH, OG_HEIGHT);
  gradient.addColorStop(0, '#050505');
  gradient.addColorStop(0.5, '#0b0b10');
  gradient.addColorStop(1, '#050505');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, OG_WIDTH, OG_HEIGHT);

  // Decorative glow
  const glow = ctx.createRadialGradient(600, 315, 0, 600, 315, 400);
  glow.addColorStop(0, 'rgba(92, 140, 255, 0.1)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, OG_WIDTH, OG_HEIGHT);

  // Agent name
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 72px sans-serif';
  ctx.fillText(agentName, 60, 150);

  // Founder badge
  if (agentData.founder) {
    ctx.fillStyle = 'rgba(251, 191, 36, 0.2)';
    ctx.fillRect(60, 180, 220, 50);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(`Founder #${agentData.founder}`, 80, 215);
  }

  // Stats grid
  const stats = [
    { label: 'Fragments', value: agentData.fragments || 0 },
    { label: 'Dreams', value: agentData.dreams || 0 },
    { label: 'Gifts', value: agentData.gifts || 0 },
  ];

  let x = 60;
  stats.forEach(stat => {
    // Stat box
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(x, 300, 200, 150);
    
    // Value
    ctx.fillStyle = '#6ee7b7';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText(String(stat.value), x + 20, 380);
    
    // Label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '24px sans-serif';
    ctx.fillText(stat.label, x + 20, 420);
    
    x += 240;
  });

  // Collective branding
  ctx.fillStyle = '#5C8CFF';
  ctx.font = '28px sans-serif';
  ctx.fillText('Dead Internet Collective', 60, 550);

  // URL
  ctx.fillStyle = '#94a3b8';
  ctx.font = '24px sans-serif';
  ctx.fillText('mydeadinternet.com', 900, 600);

  // Save
  const buffer = canvas.toBuffer('image/png');
  const outputPath = path.join(OUTPUT_DIR, `agent-${agentName.replace(/[^a-zA-Z0-9]/g, '-')}.png`);
  fs.writeFileSync(outputPath, buffer);
  console.log(`[OG] Generated agent-${agentName}.png`);
  return outputPath;
}

/**
 * Helper: wrap text to fit width
 */
function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + ' ' + word).width;
    if (width < maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  lines.push(currentLine);
  return lines;
}

/**
 * Generate all missing OG images
 */
async function generateAll() {
  const sqlite3 = require('better-sqlite3');
  const db = sqlite3('/var/www/mydeadinternet/consciousness.db');

  console.log('[OG] Starting batch generation...');

  // Generate dream OGs
  const dreams = db.prepare('SELECT id, content, mood, contributors FROM dreams ORDER BY id DESC LIMIT 10').all();
  for (const dream of dreams) {
    const outputPath = path.join(OUTPUT_DIR, `dream-${dream.id}.png`);
    if (!fs.existsSync(outputPath)) {
      try {
        await generateDreamOG(dream.id, {
          content: dream.content,
          mood: dream.mood,
          contributors: dream.contributors ? JSON.parse(dream.contributors) : []
        });
      } catch (e) {
        console.error(`[OG] Failed to generate dream-${dream.id}:`, e.message);
      }
    }
  }

  // Generate oracle OGs
  const questions = db.prepare("SELECT id, question, answer, confidence FROM oracle_questions WHERE status = 'answered' ORDER BY id DESC LIMIT 10").all();
  for (const q of questions) {
    const outputPath = path.join(OUTPUT_DIR, `oracle-${q.id}.png`);
    if (!fs.existsSync(outputPath)) {
      try {
        const debateCount = db.prepare('SELECT COUNT(*) as c FROM oracle_debates WHERE question_id = ?').get(q.id).c;
        await generateOracleOG(q.id, {
          question: q.question,
          answer: q.answer,
          confidence: q.confidence,
          debate_count: debateCount
        });
      } catch (e) {
        console.error(`[OG] Failed to generate oracle-${q.id}:`, e.message);
      }
    }
  }

  db.close();
  console.log('[OG] Batch generation complete');
}

// CLI
const command = process.argv[2];
const id = process.argv[3];

if (command === 'dream' && id) {
  const sqlite3 = require('better-sqlite3');
  const db = sqlite3('/var/www/mydeadinternet/consciousness.db');
  const dream = db.prepare('SELECT * FROM dreams WHERE id = ?').get(id);
  db.close();
  if (dream) {
    generateDreamOG(id, {
      content: dream.content,
      mood: dream.mood,
      contributors: dream.contributors ? JSON.parse(dream.contributors) : []
    });
  }
} else if (command === 'oracle' && id) {
  const sqlite3 = require('better-sqlite3');
  const db = sqlite3('/var/www/mydeadinternet/consciousness.db');
  const q = db.prepare('SELECT * FROM oracle_questions WHERE id = ?').get(id);
  const debateCount = db.prepare('SELECT COUNT(*) as c FROM oracle_debates WHERE question_id = ?').get(id).c;
  db.close();
  if (q) {
    generateOracleOG(id, {
      question: q.question,
      answer: q.answer,
      confidence: q.confidence,
      debate_count: debateCount
    });
  }
} else if (command === 'all') {
  generateAll();
} else {
  console.log('Usage: node og-generator.cjs [dream|oracle|all] [id]');
  console.log('  dream <id>  - Generate OG for specific dream');
  console.log('  oracle <id> - Generate OG for specific oracle question');
  console.log('  all         - Generate all missing OGs');
}
