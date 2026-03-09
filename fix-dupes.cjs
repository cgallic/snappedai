const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/var/www/snap/api/learnings.json', 'utf8'));

let fixed = 0;
for (const entry of data.entries) {
  const before = entry.content;
  
  // Fix duplicate headers like "**crypto Insight** **crypto Insight**"
  entry.content = entry.content.replace(/\*\*([^*]+)\*\*\s*\*\*\1\*\*/g, '**$1**');
  
  // Fix duplicate "Why This Matters" sections
  entry.content = entry.content.replace(/(\*\*Why This Matters:\*\*[^*]+)(\*\*Why This Matters:\*\*)/g, '$1');
  
  // Clean up extra newlines
  entry.content = entry.content.replace(/\n{3,}/g, '\n\n');
  
  if (before !== entry.content) fixed++;
}

fs.writeFileSync('/var/www/snap/api/learnings.json', JSON.stringify(data, null, 2));
console.log(`Fixed ${fixed} entries with duplicates`);
