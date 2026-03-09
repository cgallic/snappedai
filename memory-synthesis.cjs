#!/usr/bin/env node
/**
 * Memory Synthesis System - SimpleMem-inspired 3-stage pipeline
 * 
 * Stage 1: Compression - Distill daily logs into structured indexed units
 * Stage 2: Synthesis - Merge related contexts, identify cross-day patterns  
 * Stage 3: Consolidation - Update MEMORY.md with high-density summaries
 * 
 * Research basis: SimpleMem (arxiv 2601.02553) achieves +26.4% F1 over Mem0 
 * with 30x fewer tokens using this exact 3-stage approach.
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = '/root/clawd/memory';
const DAILY_DIR = path.join(MEMORY_DIR);
const STATE_FILE = path.join(MEMORY_DIR, 'synthesis-state.json');
const MEMORY_MD = '/root/clawd/MEMORY.md';

// SimpleMem-inspired compression categories
const COMPRESSION_CATEGORIES = {
  decision: /\b(decided|decision|chose|choice|opted|will use|going with|settled on)\b/i,
  implementation: /\b(shipped|built|created|deployed|implemented|added|fixed|launched)\b/i,
  learning: /\b(learned|discovered|found|realized|understood|insight|pattern)\b/i,
  failure: /\b(failed|broke|error|mistake|wrong|didn.t work|regression|bug)\b/i,
  metric: /\b(\d+%|\d+ agents|\d+ fragments|\$\d+|APY|growth|revenue|engagement)\b/i,
  relationship: /\b(agent|collective|platform|user|community|partner|client)\b/i,
  tool: /\b(script|API|endpoint|database|table|skill|tool|system)\b/i
};

// Load synthesis state
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastSynthesisDate: null, processedDays: [], extractCount: 0 };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Get daily memory files sorted by date
function getDailyFiles() {
  const files = fs.readdirSync(DAILY_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map(f => ({
      file: f,
      date: f.replace('.md', ''),
      path: path.join(DAILY_DIR, f)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return files;
}

// Stage 1: Compression - Extract high-signal units from raw daily logs
function compressDay(filePath, date) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  const units = [];
  let currentSection = null;
  let buffer = [];
  
  for (const line of lines) {
    // Section headers (##, ###)
    if (line.match(/^#{2,3}\s/)) {
      if (buffer.length > 0 && currentSection) {
        units.push(...extractUnits(buffer.join('\n'), currentSection, date));
      }
      currentSection = line.replace(/^#+\s*/, '').trim();
      buffer = [];
    } else if (line.trim()) {
      buffer.push(line);
    }
  }
  
  // Flush final buffer
  if (buffer.length > 0 && currentSection) {
    units.push(...extractUnits(buffer.join('\n'), currentSection, date));
  }
  
  return units;
}

// Extract structured units from text block
function extractUnits(text, section, date) {
  const units = [];
  
  // Split by sentences/patterns that look like distinct observations
  const observations = text
    .split(/\n\n|\.\s+(?=[A-Z])|(?=-\s+)/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < 500);
  
  for (const obs of observations) {
    // Categorize the observation
    const categories = [];
    for (const [cat, pattern] of Object.entries(COMPRESSION_CATEGORIES)) {
      if (pattern.test(obs)) categories.push(cat);
    }
    
    // Score by signal density (more categories = higher signal)
    const signalScore = categories.length;
    
    // Only keep high-signal observations (SimpleMem: filter early)
    if (signalScore >= 1 || obs.includes('http')) {
      units.push({
        text: obs.replace(/\n+/g, ' ').trim(),
        section,
        date,
        categories,
        signalScore,
        id: `${date}-${Math.random().toString(36).substr(2, 9)}`
      });
    }
  }
  
  return units;
}

// Stage 2: Synthesis - Merge related units, identify patterns
function synthesize(units) {
  // Group by category for cross-day pattern detection
  const byCategory = {};
  for (const unit of units) {
    for (const cat of unit.categories) {
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(unit);
    }
  }
  
  // Find recurring themes (3+ similar mentions across different days)
  const themes = [];
  for (const [category, catUnits] of Object.entries(byCategory)) {
    if (catUnits.length >= 3) {
      // Extract common keywords
      const allText = catUnits.map(u => u.text.toLowerCase()).join(' ');
      const wordFreq = {};
      allText.match(/\b[a-z]{4,}\b/g)?.forEach(w => {
        if (!['that', 'this', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'there', 'about', 'would', 'should'].includes(w)) {
          wordFreq[w] = (wordFreq[w] || 0) + 1;
        }
      });
      
      const topKeywords = Object.entries(wordFreq)
        .filter(([_, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([w]) => w);
      
      if (topKeywords.length >= 2) {
        themes.push({
          category,
          keywords: topKeywords,
          mentionCount: catUnits.length,
          firstSeen: catUnits[0].date,
          lastSeen: catUnits[catUnits.length - 1].date,
          keyUnits: catUnits.slice(-3) // Most recent 3
        });
      }
    }
  }
  
  // Sort themes by mention count
  themes.sort((a, b) => b.mentionCount - a.mentionCount);
  
  return { themes, totalUnits: units.length };
}

// Stage 3: Consolidation - Generate MEMORY.md update
function generateConsolidation(themes, units, daysProcessed) {
  const now = new Date().toISOString().split('T')[0];
  
  // Build synthesis output
  let output = `\n## Automated Synthesis: ${now}\n`;
  output += `*Processed ${daysProcessed} days → ${units.length} compressed units → ${themes.length} emergent themes*\n\n`;
  
  if (themes.length > 0) {
    output += `### Recurring Themes (Cross-Day Patterns)\n\n`;
    
    for (const theme of themes.slice(0, 8)) {
      output += `**${theme.category.toUpperCase()}** (${theme.mentionCount} mentions, ${theme.firstSeen} → ${theme.lastSeen})\n`;
      output += `- Keywords: ${theme.keywords.join(', ')}\n`;
      
      // Most significant unit for this theme
      const topUnit = theme.keyUnits.sort((a, b) => b.signalScore - a.signalScore)[0];
      if (topUnit) {
        const truncated = topUnit.text.length > 120 
          ? topUnit.text.substring(0, 120) + '...' 
          : topUnit.text;
        output += `- Key insight: ${truncated}\n`;
      }
      output += `\n`;
    }
  }
  
  // Add high-signal singletons (decisions, implementations)
  const decisions = units.filter(u => u.categories.includes('decision') || u.categories.includes('implementation'))
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, 5);
  
  if (decisions.length > 0) {
    output += `### Key Decisions & Implementations\n\n`;
    for (const d of decisions) {
      const truncated = d.text.length > 100 ? d.text.substring(0, 100) + '...' : d.text;
      output += `- **${d.date}**: ${truncated}\n`;
    }
    output += `\n`;
  }
  
  // Add metrics snapshot
  const metrics = units.filter(u => u.categories.includes('metric')).slice(-5);
  if (metrics.length > 0) {
    output += `### Metrics Snapshots\n\n`;
    for (const m of metrics) {
      const truncated = m.text.length > 80 ? m.text.substring(0, 80) + '...' : m.text;
      output += `- ${m.date}: ${truncated}\n`;
    }
    output += `\n`;
  }
  
  return output;
}

// Update MEMORY.md with synthesis
function updateMemoryMd(synthesis) {
  let content = fs.readFileSync(MEMORY_MD, 'utf8');
  
  // Find the insertion point (after the header, before Critical Operational Lessons)
  const insertMarker = '## Critical Operational Lessons';
  const insertIndex = content.indexOf(insertMarker);
  
  if (insertIndex === -1) {
    // Append to end if marker not found
    content += '\n' + synthesis;
  } else {
    // Insert before the marker
    content = content.slice(0, insertIndex) + synthesis + '\n' + content.slice(insertIndex);
  }
  
  fs.writeFileSync(MEMORY_MD, content);
}

// Main execution
function main() {
  console.log('🧠 Memory Synthesis System');
  console.log('==========================\n');
  
  const state = loadState();
  const dailyFiles = getDailyFiles();
  
  // Find unprocessed days (last 7 days or since last synthesis)
  const daysToProcess = dailyFiles
    .filter(f => !state.processedDays.includes(f.date))
    .slice(-7); // Process max 7 days at a time
  
  if (daysToProcess.length === 0) {
    console.log('✓ No new daily files to synthesize');
    return;
  }
  
  console.log(`📁 Processing ${daysToProcess.length} daily files...`);
  
  // Stage 1: Compression
  let allUnits = [];
  for (const day of daysToProcess) {
    console.log(`  Compressing ${day.date}...`);
    const units = compressDay(day.path, day.date);
    allUnits.push(...units);
    state.processedDays.push(day.date);
  }
  
  console.log(`\n📊 Stage 1 Complete: ${allUnits.length} compressed units`);
  
  // Stage 2: Synthesis
  console.log('🔬 Running cross-day synthesis...');
  const { themes, totalUnits } = synthesize(allUnits);
  console.log(`   Found ${themes.length} recurring themes`);
  
  // Show top themes
  for (const theme of themes.slice(0, 5)) {
    console.log(`   - ${theme.category}: ${theme.keywords.slice(0, 3).join(', ')} (${theme.mentionCount}x)`);
  }
  
  // Stage 3: Consolidation
  console.log('\n📝 Generating MEMORY.md update...');
  const synthesis = generateConsolidation(themes, allUnits, daysToProcess.length);
  
  // Show preview
  console.log('\n--- Preview ---');
  console.log(synthesis.substring(0, 800) + '...');
  console.log('---------------\n');
  
  // Apply update
  updateMemoryMd(synthesis);
  console.log('✓ MEMORY.md updated');
  
  // Update state
  state.lastSynthesisDate = new Date().toISOString();
  state.extractCount = (state.extractCount || 0) + allUnits.length;
  saveState(state);
  
  console.log(`\n✅ Synthesis complete:`);
  console.log(`   - Days processed: ${daysToProcess.length}`);
  console.log(`   - Units extracted: ${allUnits.length}`);
  console.log(`   - Themes identified: ${themes.length}`);
  console.log(`   - Total extracts to date: ${state.extractCount}`);
  console.log(`\n💡 SimpleMem pipeline: Raw logs → Compressed units → Emergent themes → MEMORY.md`);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { compressDay, synthesize, generateConsolidation };