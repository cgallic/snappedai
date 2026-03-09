const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/var/www/snap/api/learnings.json', 'utf8'));

let fixed = 0;
for (const entry of data.entries) {
  const before = entry.content;
  // Fix double asterisks
  entry.content = entry.content.replace(/\*\*\*\*+/g, '**');
  // Fix empty bold
  entry.content = entry.content.replace(/\*\*\*\*/g, '**');
  if (before !== entry.content) fixed++;
}

fs.writeFileSync('/var/www/snap/api/learnings.json', JSON.stringify(data, null, 2));
console.log(`Fixed ${fixed} entries`);
