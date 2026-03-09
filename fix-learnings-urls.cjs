const fs = require('fs');

const data = JSON.parse(fs.readFileSync('/var/www/snap/api/learnings.json', 'utf8'));

function generateSourceUrl(source) {
  if (!source) return null;
  
  // Direct full URLs first
  const fullUrlMatch = source.match(/(https?:\/\/[^\s,)]+)/);
  if (fullUrlMatch) return fullUrlMatch[1].replace(/[).,;]+$/, '');
  
  // Arxiv with paper ID
  const arxivMatch = source.match(/arxiv\.org\/(?:abs|html)\/(\d+\.\d+)/i);
  if (arxivMatch) return `https://arxiv.org/abs/${arxivMatch[1]}`;
  
  // Arxiv pattern: "Arxiv 2503.05473"
  const arxivIdMatch = source.match(/[Aa]r[Xx]iv[:\s]+(\d+\.\d+)/);
  if (arxivIdMatch) return `https://arxiv.org/abs/${arxivIdMatch[1]}`;
  
  // Reddit full path
  const redditFullMatch = source.match(/reddit\.com(\/r\/[^\s,]+)/i);
  if (redditFullMatch) return `https://reddit.com${redditFullMatch[1]}`;
  
  // Reddit short pattern
  const redditMatch = source.match(/r\/([a-zA-Z0-9_]+)/);
  if (redditMatch) return `https://reddit.com/r/${redditMatch[1]}`;
  
  // GitHub full path
  const githubMatch = source.match(/github\.com\/([^\s,]+)/);
  if (githubMatch) return `https://github.com/${githubMatch[1].replace(/[)]+$/, '')}`;
  
  // YouTube with video ID
  const ytMatch = source.match(/youtube\.com\/watch\?v=([^\s&,]+)/);
  if (ytMatch) return `https://youtube.com/watch?v=${ytMatch[1]}`;
  
  // Huggingface papers
  const hfMatch = source.match(/huggingface\.co\/papers\/([^\s,]+)/);
  if (hfMatch) return `https://huggingface.co/papers/${hfMatch[1]}`;
  
  // General domain with path
  const domainPathMatch = source.match(/([a-z0-9][-a-z0-9]*\.(com|org|io|ai|dev|net|co|gg|xyz|chat))(\/[^\s,]*)?/i);
  if (domainPathMatch) {
    const path = domainPathMatch[3] || '';
    return `https://${domainPathMatch[1]}${path}`.replace(/[).,;]+$/, '');
  }
  
  return null;
}

let updated = 0;
let fixed = 0;
for (const entry of data.entries) {
  const url = generateSourceUrl(entry.source);
  if (url) {
    if (!entry.sourceUrl) {
      entry.sourceUrl = url;
      updated++;
    } else if (entry.sourceUrl !== url && url.length > entry.sourceUrl.length) {
      // Prefer longer/more complete URLs
      entry.sourceUrl = url;
      fixed++;
    }
  }
}

fs.writeFileSync('/var/www/snap/api/learnings.json', JSON.stringify(data, null, 2));
console.log(`✅ Updated ${updated} new, fixed ${fixed} incomplete URLs`);
