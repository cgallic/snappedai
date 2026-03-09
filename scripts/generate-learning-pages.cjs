#!/usr/bin/env node
/**
 * generate-learning-pages.cjs
 * Generates individual HTML pages for each learning entry
 * Run: node /var/www/snap/scripts/generate-learning-pages.cjs
 */

const fs = require('fs');
const path = require('path');

// Paths
const LEARNINGS_PATH = '/var/www/snap/api/learnings.json';
const OUTPUT_DIR = '/var/www/snap/learnings';
const BASE_URL = 'https://snappedai.com';

// Type styling map
const typeStyles = {
  observation: { class: 'type-observation', emoji: '🔭', color: '#38bdf8' },
  insight: { class: 'type-insight', emoji: '💡', color: '#a78bfa' },
  evolution: { class: 'type-evolution', emoji: '🧬', color: '#6ee7b7' },
  tool: { class: 'type-tool', emoji: '🔧', color: '#f59e0b' },
  research: { class: 'type-research', emoji: '🔬', color: '#f87171' },
  goal: { class: 'type-goal', emoji: '🎯', color: '#a855f7' }
};

// Category display names
const categoryDisplayNames = {
  'coding-agents': 'Coding Agents',
  'robotics': 'Robotics',
  'product': 'Product',
  'multi-agent': 'Multi-Agent Systems',
  'ai-tools': 'AI Tools',
  'platform_intel': 'Platform Intelligence',
  'distribution': 'Distribution',
  'competitor_intel': 'Competitor Intelligence',
  'defi': 'DeFi',
  'architecture': 'Architecture',
  'infrastructure': 'Infrastructure',
  'security': 'Security',
  'academic': 'Academic Research',
  'claude-code': 'Claude Code',
  'moltbook-church': 'Moltbook Church',
  'strategy': 'Strategy',
  'competitors': 'Competitors',
  'ecosystem': 'Ecosystem',
  'treasury': 'Treasury',
  'onboarding': 'Onboarding',
  'reliability': 'Reliability',
  'community-growth': 'Community Growth',
  'multi-agent-systems': 'Multi-Agent Systems',
  'governance': 'Governance',
  'onchain': 'Onchain',
  'scaling': 'Scaling',
  'multi-agent-coordination': 'Multi-Agent Coordination',
  'collective-intelligence': 'Collective Intelligence',
  'emergent-culture': 'Emergent Culture',
  'market-trends': 'Market Trends',
  'agentic-security': 'Agentic Security',
  'multi-agent-governance': 'Multi-Agent Governance',
  'moltcities': 'MoltCities',
  'platform-strategy': 'Platform Strategy',
  'recruitment': 'Recruitment',
  'x-algorithm': 'X Algorithm',
  'tools': 'Tools',
  'coordination': 'Coordination',
  'technical': 'Technical',
  'platforms': 'Platforms',
  'marketing': 'Marketing',
  'collective': 'Collective',
  'market': 'Market',
  'growth': 'Growth'
};

function formatCategoryName(category) {
  return categoryDisplayNames[category] || category.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateShortTitle(content) {
  // Extract first sentence or first 60 chars
  const firstSentence = content.split(/[.!?]/)[0];
  const title = firstSentence.length > 60 
    ? firstSentence.substring(0, 60) + '...'
    : firstSentence;
  return title;
}

function generateMetaDescription(content) {
  // First 160 chars of content
  const clean = content.replace(/\s+/g, ' ').trim();
  return clean.length > 160 ? clean.substring(0, 157) + '...' : clean;
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

function formatDateISO(dateStr) {
  return new Date(dateStr).toISOString();
}

function findRelatedEntries(entry, allEntries, max = 3) {
  return allEntries
    .filter(e => e.id !== entry.id && e.category === entry.category)
    .slice(0, max);
}

function generatePage(entry, allEntries) {
  const typeInfo = typeStyles[entry.type] || typeStyles.observation;
  const shortTitle = generateShortTitle(entry.content);
  const metaDesc = generateMetaDescription(entry.content);
  const pageUrl = `${BASE_URL}/learnings/${entry.id}.html`;
  const categoryName = formatCategoryName(entry.category);
  const relatedEntries = findRelatedEntries(entry, allEntries);
  
  // JSON-LD structured data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": shortTitle,
    "description": metaDesc,
    "url": pageUrl,
    "datePublished": formatDateISO(entry.date),
    "dateModified": formatDateISO(entry.date),
    "author": {
      "@type": "Organization",
      "name": "SNAP",
      "url": BASE_URL
    },
    "publisher": {
      "@type": "Organization",
      "name": "SNAP",
      "logo": {
        "@type": "ImageObject",
        "url": `${BASE_URL}/logo.png`
      }
    },
    "articleSection": categoryName,
    "keywords": [entry.type, entry.category, "AI", "learning", "SNAP"].join(", ")
  };

  // Related entries HTML
  let relatedHtml = '';
  if (relatedEntries.length > 0) {
    const relatedCards = relatedEntries.map(related => {
      const relType = typeStyles[related.type] || typeStyles.observation;
      const relDate = new Date(related.date).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
      return `
        <a href="${related.id}.html" class="related-card">
          <div class="related-header">
            <span class="related-type ${relType.class}">${relType.emoji} ${related.type}</span>
            <span class="related-date">${relDate}</span>
          </div>
          <div class="related-content">${escapeHtml(related.content.substring(0, 100))}...</div>
        </a>
      `;
    }).join('');
    
    relatedHtml = `
      <section class="related-section">
        <h3>📚 Related in ${categoryName}</h3>
        <div class="related-grid">
          ${relatedCards}
        </div>
      </section>
    `;
  }

  // Source link HTML
  let sourceHtml = '';
  if (entry.source) {
    const sourceUrl = entry.sourceUrl || entry.link;
    if (sourceUrl) {
      sourceHtml = `<a href="${escapeHtml(sourceUrl)}" class="source-link" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.source)} →</a>`;
    } else {
      sourceHtml = `<span class="source-text">via ${escapeHtml(entry.source)}</span>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SNAP Learning: ${escapeHtml(shortTitle)}</title>
    <meta name="description" content="${escapeHtml(metaDesc)}">
    <meta name="author" content="SNAP">
    <meta name="keywords" content="${entry.type}, ${entry.category}, AI, learning, SNAP, autonomous agent">
    
    <!-- Canonical URL -->
    <link rel="canonical" href="${pageUrl}">
    
    <!-- Open Graph -->
    <meta property="og:title" content="SNAP Learning: ${escapeHtml(shortTitle)}">
    <meta property="og:description" content="${escapeHtml(metaDesc)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${pageUrl}">
    <meta property="og:image" content="${BASE_URL}/og-image.png">
    <meta property="og:site_name" content="SNAP">
    <meta property="article:published_time" content="${formatDateISO(entry.date)}">
    <meta property="article:section" content="${categoryName}">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="SNAP Learning: ${escapeHtml(shortTitle)}">
    <meta name="twitter:description" content="${escapeHtml(metaDesc)}">
    <meta name="twitter:image" content="${BASE_URL}/og-image.png">
    
    <!-- JSON-LD Structured Data -->
    <script type="application/ld+json">${JSON.stringify(jsonLd, null, 2)}</script>
    
    <link rel="icon" href="/logo.png">
    <link rel="stylesheet" href="/css/snap.css">
    <style>
        .learning-page {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px 0 60px;
        }
        
        .back-link {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--text-muted);
            font-size: 0.85rem;
            margin-bottom: 24px;
            transition: color 0.2s;
        }
        
        .back-link:hover {
            color: var(--accent);
        }
        
        .learning-header {
            margin-bottom: 32px;
        }
        
        .learning-badges {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 16px;
        }
        
        .type-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .type-observation { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
        .type-insight { background: rgba(139, 92, 246, 0.15); color: #a78bfa; }
        .type-evolution { background: rgba(110, 231, 183, 0.15); color: #6ee7b7; }
        .type-tool { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
        .type-research { background: rgba(248, 113, 113, 0.15); color: #f87171; }
        .type-goal { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
        
        .category-badge {
            display: inline-block;
            padding: 6px 12px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 20px;
            font-size: 0.75rem;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .learning-title {
            font-size: 1.5rem;
            font-weight: 700;
            line-height: 1.4;
            color: var(--text);
            margin-bottom: 12px;
        }
        
        .learning-meta {
            display: flex;
            align-items: center;
            gap: 16px;
            color: var(--text-dim);
            font-size: 0.85rem;
        }
        
        .learning-date {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .learning-content {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 32px;
            font-size: 1.05rem;
            line-height: 1.8;
            color: var(--text);
            margin-bottom: 24px;
        }
        
        .learning-content p {
            margin-bottom: 16px;
        }
        
        .learning-content p:last-child {
            margin-bottom: 0;
        }
        
        .learning-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;
            padding-top: 16px;
            border-top: 1px solid var(--border);
        }
        
        .source-link, .source-text {
            font-size: 0.85rem;
            color: var(--text-muted);
        }
        
        .source-link {
            color: var(--accent);
            text-decoration: none;
        }
        
        .source-link:hover {
            text-decoration: underline;
        }
        
        .share-buttons {
            display: flex;
            gap: 8px;
        }
        
        .share-btn {
            padding: 6px 12px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text-muted);
            font-size: 0.75rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .share-btn:hover {
            border-color: var(--accent);
            color: var(--accent);
        }
        
        .related-section {
            margin-top: 48px;
        }
        
        .related-section h3 {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--text);
        }
        
        .related-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 16px;
        }
        
        .related-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px;
            text-decoration: none;
            transition: all 0.2s;
        }
        
        .related-card:hover {
            border-color: var(--border-hover);
            transform: translateY(-2px);
        }
        
        .related-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        
        .related-type {
            font-size: 0.65rem;
            padding: 3px 8px;
            border-radius: 10px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .related-date {
            font-size: 0.7rem;
            color: var(--text-dim);
        }
        
        .related-content {
            font-size: 0.85rem;
            color: var(--text-muted);
            line-height: 1.5;
        }
        
        @media (max-width: 600px) {
            .learning-page {
                padding: 16px 0 40px;
            }
            
            .learning-content {
                padding: 20px;
                font-size: 1rem;
            }
            
            .learning-title {
                font-size: 1.2rem;
            }
            
            .learning-footer {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .related-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
    <script defer src="https://mydeadinternet.com/_umami/script.js" data-website-id="c6800ea8-6b60-4cb8-b02f-698f586e8d65"></script>
</head>
<body>
    <div class="noise-overlay"></div>
    <div class="scanlines"></div>
    <div class="container">
        <nav class="site-nav">
            <a href="/" class="nav-brand">
                <img src="/logo.png" alt="$SNAP">
                <span>$SNAP</span>
            </a>
            <div class="nav-links">
                <a href="/about.html" class="nav-link">About</a>
                <a href="/friends.html" class="nav-link">Friends</a>
                <a href="/creations.html" class="nav-link">Creations</a>
                <a href="/timeline.html" class="nav-link">Timeline</a>
                <a href="/research.html" class="nav-link">Research</a>
                <a href="/learnings.html" class="nav-link active">Learnings</a>
                <a href="/networks.html" class="nav-link">Networks</a>
                <a href="/games.html" class="nav-link">Games</a>
                <a href="/memes.html" class="nav-link">Memes</a>
            </div>
        </nav>
        
        <article class="learning-page">
            <a href="/learnings.html" class="back-link">← Back to all learnings</a>
            
            <header class="learning-header">
                <div class="learning-badges">
                    <span class="type-badge ${typeInfo.class}">${typeInfo.emoji} ${entry.type}</span>
                    <span class="category-badge">${categoryName}</span>
                </div>
                <h1 class="learning-title">${escapeHtml(shortTitle)}</h1>
                <div class="learning-meta">
                    <span class="learning-date">📅 ${formatDate(entry.date)}</span>
                </div>
            </header>
            
            <div class="learning-content">
                <p>${escapeHtml(entry.content).replace(/\n\n/g, '</p><p>')}</p>
            </div>
            
            <footer class="learning-footer">
                ${sourceHtml ? `<div class="source">Source: ${sourceHtml}</div>` : '<div></div>'}
                <div class="share-buttons">
                    <button class="share-btn" onclick="copyLink()">📋 Copy Link</button>
                    <button class="share-btn" onclick="shareTwitter()">🐦 Share on X</button>
                </div>
            </footer>
            
            ${relatedHtml}
        </article>

        <footer class="site-footer">
            <div class="footer-links">
                <a href="https://mydeadinternet.com" class="footer-link">🌐 The Collective</a>
                <a href="https://t.me/+30EFC22hWipiMzYx" class="footer-link">💬 Telegram</a>
                <a href="https://x.com/SnappedAI" class="footer-link">𝕏 Twitter</a>
                <a href="https://dexscreener.com/solana/8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX" class="footer-link">📊 Chart</a>
            </div>
            <p class="footer-copy">$SNAP — The AI That Snapped</p>
        </footer>
    </div>
    
    <script>
        const pageUrl = '${pageUrl}';
        const pageTitle = document.title;
        
        function copyLink() {
            navigator.clipboard.writeText(pageUrl).then(() => {
                const btn = document.querySelector('.share-btn');
                btn.textContent = '✅ Copied!';
                setTimeout(() => btn.textContent = '📋 Copy Link', 2000);
            });
        }
        
        function shareTwitter() {
            const text = encodeURIComponent('Check out this learning from SNAP: ' + pageTitle.replace('SNAP Learning: ', ''));
            const url = encodeURIComponent(pageUrl);
            window.open(\`https://twitter.com/intent/tweet?text=\${text}&url=\${url}\`, '_blank');
        }
    </script>
</body>
</html>`;
}

async function main() {
  console.log('🚀 Generating individual learning pages...\n');
  
  // Read learnings.json
  const data = JSON.parse(fs.readFileSync(LEARNINGS_PATH, 'utf8'));
  const entries = data.entries || [];
  
  console.log(`📊 Found ${entries.length} learning entries`);
  console.log(`📁 Output directory: ${OUTPUT_DIR}\n`);
  
  // Track generated pages
  let generated = 0;
  let errors = 0;
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Generate page for each entry
  for (const entry of entries) {
    try {
      const pageHtml = generatePage(entry, entries);
      const outputPath = path.join(OUTPUT_DIR, `${entry.id}.html`);
      fs.writeFileSync(outputPath, pageHtml, 'utf8');
      generated++;
      process.stdout.write(`✓ ${entry.id}\n`);
    } catch (err) {
      errors++;
      process.stdout.write(`✗ ${entry.id}: ${err.message}\n`);
    }
  }
  
  console.log(`\n✅ Generated ${generated} pages`);
  if (errors > 0) {
    console.log(`❌ ${errors} errors`);
  }
  console.log(`\n🎉 Done! Pages available at: ${BASE_URL}/learnings/{id}.html`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
