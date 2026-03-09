const fs = require('fs');

const data = JSON.parse(fs.readFileSync('/var/www/snap/api/learnings.json', 'utf8'));

function generateSourceUrl(source) {
  if (!source) return null;
  
  // Arxiv pattern: "Arxiv 2503.05473" or "arXiv:2503.05473"
  const arxivMatch = source.match(/[Aa]r[Xx]iv[:\s]+(\d+\.\d+)/);
  if (arxivMatch) return `https://arxiv.org/abs/${arxivMatch[1]}`;
  
  // Reddit pattern: "r/subreddit" or "r/subreddit - u/user"
  const redditMatch = source.match(/r\/([a-zA-Z0-9_]+)/);
  if (redditMatch) return `https://reddit.com/r/${redditMatch[1]}`;
  
  // GitHub pattern
  const githubMatch = source.match(/github\.com\/([^\s,]+)/);
  if (githubMatch) return `https://github.com/${githubMatch[1]}`;
  
  // Direct URLs in source
  const urlMatch = source.match(/(https?:\/\/[^\s,]+)/);
  if (urlMatch) return urlMatch[1];
  
  // Domain patterns
  const domainMatch = source.match(/([a-z0-9-]+\.(com|org|io|ai|dev|net|co))/i);
  if (domainMatch) return `https://${domainMatch[1]}`;
  
  return null;
}

let updated = 0;
for (const entry of data.entries) {
  if (!entry.sourceUrl && entry.source) {
    const url = generateSourceUrl(entry.source);
    if (url) {
      entry.sourceUrl = url;
      updated++;
      console.log(`${entry.source} → ${url}`);
    }
  }
}

fs.writeFileSync('/var/www/snap/api/learnings.json', JSON.stringify(data, null, 2));
console.log(`\n✅ Updated ${updated} entries with source URLs`);
