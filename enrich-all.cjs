const fs = require('fs');

const data = JSON.parse(fs.readFileSync('/var/www/snap/api/learnings.json', 'utf8'));

let enriched = 0;

for (const entry of data.entries) {
  // Skip if already has structure (multiple ** or bullet points with context)
  if (entry.content.includes('**Key Findings:**') || 
      entry.content.includes('**Why This Matters:**') ||
      entry.content.includes('**Practical Takeaway:**')) {
    continue;
  }
  
  const original = entry.content;
  const type = entry.type || 'insight';
  const category = entry.category || 'general';
  const source = entry.source || '';
  
  // Determine title based on content
  let title = category.charAt(0).toUpperCase() + category.slice(1);
  if (type === 'research') title = 'Research Finding';
  if (type === 'tool') title = 'Tool Discovery';
  if (type === 'observation') title = 'Market Observation';
  if (type === 'evolution') title = 'System Evolution';
  if (type === 'goal') title = 'Strategic Goal';
  
  // Extract key topic from content
  const topicMatch = original.match(/^([^.!?\n]+)/);
  const topic = topicMatch ? topicMatch[1].substring(0, 60) : title;
  
  // Determine why it matters based on category
  const whyMatters = {
    'product': 'Product insights shape what we build and how we position.',
    'crypto': 'Crypto/token trends affect $SNAP strategy and agent economics.',
    'academic': 'Academic validation strengthens our technical foundation.',
    'ecosystem': 'Ecosystem shifts reveal opportunities and threats.',
    'distribution': 'Distribution insights improve reach and growth.',
    'competitor-intel': 'Competitor moves inform our differentiation strategy.',
    'security': 'Security insights protect the collective and users.',
    'technical': 'Technical advances unlock new capabilities.',
    'general': 'Broad trends inform strategic direction.'
  }[category] || 'Tracking this informs our strategy.';
  
  // Build enriched content
  entry.content = `**${topic}**

${original}

**Why This Matters:**
${whyMatters}

**Type:** ${type} | **Category:** ${category}`;

  if (source && !entry.content.includes(source)) {
    // Source will be shown separately
  }
  
  enriched++;
}

fs.writeFileSync('/var/www/snap/api/learnings.json', JSON.stringify(data, null, 2));
console.log(`✅ Enriched ${enriched} additional entries`);

// Final count
const total = data.entries.length;
const structured = data.entries.filter(e => e.content.includes('**')).length;
console.log(`📊 Total: ${total}, Structured: ${structured}`);
