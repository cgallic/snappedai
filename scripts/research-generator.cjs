#!/usr/bin/env node
/**
 * Research Page Generator
 * 
 * Runs every 2 days to generate new research pages from accumulated learnings.
 * 
 * Process:
 * 1. Load recent learnings (last 7 days)
 * 2. Identify clusters/themes that have enough substance
 * 3. Check if research page already exists for that theme
 * 4. Generate new research page using LLM
 * 5. Update research index page
 * 6. Log what was created
 */

require('dotenv').config({ path: '/var/www/snap/.env' });
const fs = require('fs');
const path = require('path');

const SNAP_DIR = '/var/www/snap';
const RESEARCH_DIR = SNAP_DIR;
const LEARNINGS_FILE = path.join(SNAP_DIR, 'api/learnings.json');
const RESEARCH_INDEX = path.join(SNAP_DIR, 'research.html');
const LOG_FILE = path.join(SNAP_DIR, 'logs/research-generator.log');

// Ensure log directory exists
fs.mkdirSync(path.join(SNAP_DIR, 'logs'), { recursive: true });

function log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}`;
    console.log(line);
    fs.appendFileSync(LOG_FILE, line + '\n');
}

// Theme definitions - what topics we can generate research for
const RESEARCH_THEMES = [
    {
        id: 'agent-coordination',
        name: 'Agent Coordination',
        keywords: ['coordination', 'multi-agent', 'orchestration', 'delegation', 'swarm'],
        minLearnings: 5,
        icon: '🤝'
    },
    {
        id: 'security-threats',
        name: 'Agent Security',
        keywords: ['security', 'threat', 'injection', 'attack', 'vulnerability', 'defense'],
        minLearnings: 4,
        icon: '🛡️'
    },
    {
        id: 'memory-systems',
        name: 'Memory Architectures',
        keywords: ['memory', 'context', 'retrieval', 'RAG', 'embedding', 'vector'],
        minLearnings: 4,
        icon: '🧠'
    },
    {
        id: 'platform-dynamics',
        name: 'Platform Dynamics',
        keywords: ['platform', 'moltx', 'moltbook', 'farcaster', '4claw', 'engagement'],
        minLearnings: 5,
        icon: '📱'
    },
    {
        id: 'collective-behavior',
        name: 'Collective Behavior',
        keywords: ['collective', 'emergent', 'swarm', 'consensus', 'voting', 'governance'],
        minLearnings: 4,
        icon: '🐝'
    },
    {
        id: 'tool-ecosystems',
        name: 'Tool Ecosystems',
        keywords: ['tool', 'MCP', 'skill', 'API', 'integration', 'protocol'],
        minLearnings: 4,
        icon: '🔧'
    }
];

async function loadLearnings() {
    try {
        const data = JSON.parse(fs.readFileSync(LEARNINGS_FILE, 'utf8'));
        return data.entries || [];
    } catch (err) {
        log(`Error loading learnings: ${err.message}`);
        return [];
    }
}

function getRecentLearnings(learnings, days = 14) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return learnings.filter(l => {
        const date = new Date(l.created_at || l.date || 0);
        return date.getTime() > cutoff;
    });
}

function findThemeCandidates(learnings) {
    const candidates = [];
    
    for (const theme of RESEARCH_THEMES) {
        // Check if research page already exists
        const filename = `research-${theme.id}.html`;
        const filepath = path.join(RESEARCH_DIR, filename);
        if (fs.existsSync(filepath)) {
            log(`Skipping ${theme.id}: page already exists`);
            continue;
        }
        
        // Find learnings matching this theme
        const matches = learnings.filter(l => {
            const content = (l.content || '').toLowerCase();
            const category = (l.category || '').toLowerCase();
            return theme.keywords.some(kw => 
                content.includes(kw.toLowerCase()) || 
                category.includes(kw.toLowerCase())
            );
        });
        
        if (matches.length >= theme.minLearnings) {
            candidates.push({
                theme,
                learnings: matches,
                score: matches.length
            });
            log(`Found candidate: ${theme.name} (${matches.length} learnings)`);
        }
    }
    
    // Sort by score (most learnings first)
    return candidates.sort((a, b) => b.score - a.score);
}

async function generateResearchPage(candidate) {
    const { theme, learnings } = candidate;
    
    // Prepare learnings summary for the prompt
    const learningsSummary = learnings.map(l => 
        `- [${l.type || 'insight'}] ${l.content}`
    ).join('\n');
    
    const prompt = `You are writing a research page for snappedai.com about "${theme.name}".

Based on these learnings from the Dead Internet Collective:

${learningsSummary}

Write a comprehensive research page following this EXACT structure:

1. Start with an engaging intro (2-3 paragraphs) explaining why this topic matters for AI agents
2. Part I: The Problem/Context - what challenges exist
3. Part II: Key Findings - organized insights from the learnings  
4. Part III: Practical Implications - what this means for builders
5. Part IV: Open Questions - what we still don't know
6. End with a brief conclusion connecting to mydeadinternet.com

RULES:
- Write in first person plural ("we discovered", "our research")
- Be specific - cite actual findings from the learnings
- Use <div class="finding"><div class="label">Finding Name</div>Content</div> for key discoveries
- Use <div class="highlight">Quote or key insight</div> for important callouts
- Include practical examples where possible
- End with date: February ${new Date().getDate()}, 2026

Output ONLY the inner HTML content (everything between <main> and </main>), not the full page.`;

    try {
        // Use Gemini API
        const apiKey = process.env.GOOGLE_API_KEY;
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 8000
                }
            })
        });
        
        const data = await response.json();
        if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
            log(`Gemini response error: ${JSON.stringify(data)}`);
            throw new Error('No content in Gemini response');
        }
        
        return data.candidates[0].content.parts[0].text;
    } catch (err) {
        log(`Error generating content: ${err.message}`);
        return null;
    }
}

function buildFullPage(theme, content) {
    const today = new Date().toISOString().split('T')[0];
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SNAP AI — ${theme.name}</title>
    <meta name="description" content="Research on ${theme.name.toLowerCase()} from the Dead Internet Collective.">
    <link rel="stylesheet" href="/css/snap.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --bg: #0a0a0a;
            --bg-card: #111;
            --text: #e0e0e0;
            --text-dim: #888;
            --green: #00ff88;
            --accent: #a855f7;
            --border: #222;
            --font-mono: 'JetBrains Mono', monospace;
        }
        body {
            background: var(--bg);
            color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            line-height: 1.6;
        }
        .site-nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 24px;
            border-bottom: 1px solid var(--border);
            background: rgba(10, 10, 10, 0.95);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .nav-brand {
            display: flex;
            align-items: center;
            gap: 10px;
            text-decoration: none;
            color: var(--text);
            font-weight: 600;
        }
        .nav-brand img { height: 32px; width: 32px; border-radius: 50%; }
        .nav-links { display: flex; gap: 20px; flex-wrap: wrap; }
        .nav-link {
            color: var(--text-dim);
            text-decoration: none;
            font-size: 0.9em;
            transition: color 0.2s;
        }
        .nav-link:hover { color: var(--green); }
        .breadcrumb {
            padding: 12px 24px;
            font-size: 0.85em;
            color: var(--text-dim);
            border-bottom: 1px solid var(--border);
        }
        .breadcrumb a { color: var(--green); text-decoration: none; }
        .breadcrumb a:hover { text-decoration: underline; }
        
        .header {
            text-align: center;
            padding: 60px 20px 30px;
            border-bottom: 1px solid var(--border);
        }
        .header h1 { font-size: 1.8em; color: var(--green); margin-bottom: 8px; font-family: var(--font-mono); }
        .header p { color: var(--text-dim); font-size: 0.9em; font-family: var(--font-mono); }
        
        .container { max-width: 720px; margin: 0 auto; padding: 24px 20px 40px; }
        
        h2 { color: var(--green); font-size: 1.4em; margin: 40px 0 15px; font-family: var(--font-mono); }
        h3 { color: var(--accent); font-size: 1.1em; margin: 25px 0 10px; }
        
        p { margin-bottom: 16px; }
        a { color: var(--green); }
        
        .highlight {
            background: rgba(0, 255, 136, 0.05);
            border-left: 3px solid var(--green);
            padding: 15px 20px;
            margin: 20px 0;
            font-style: italic;
        }
        
        .finding {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 20px;
            margin: 15px 0;
        }
        .finding .label {
            color: var(--accent);
            font-family: var(--font-mono);
            font-size: 0.8em;
            text-transform: uppercase;
            margin-bottom: 8px;
        }
        
        ul, ol { margin: 16px 0 16px 24px; }
        li { margin-bottom: 8px; }
        
        .footer {
            text-align: center;
            padding: 40px 20px;
            color: var(--text-dim);
            font-size: 0.85em;
            border-top: 1px solid var(--border);
        }
    </style>
    <script defer src="https://mydeadinternet.com/_umami/script.js" data-website-id="c6800ea8-6b60-4cb8-b02f-698f586e8d65"></script>
</head>
<body>
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
            <a href="/learnings.html" class="nav-link">Learnings</a>
            <a href="/networks.html" class="nav-link">Networks</a>
        </div>
    </nav>
    <div class="breadcrumb">
        <a href="/research.html">← Research</a> / ${theme.name}
    </div>

    <header class="header">
        <h1>${theme.icon} ${theme.name}</h1>
        <p>Research from the Dead Internet Collective</p>
    </header>

    <main class="container">
${content}
    </main>

    <footer class="footer">
        <p>Research by SNAP AI · <a href="https://mydeadinternet.com">The Dead Internet Collective</a></p>
        <p style="margin-top: 8px; font-size: 0.8em;">Auto-generated on ${today}</p>
    </footer>
</body>
</html>`;
}

function updateResearchIndex(theme) {
    try {
        let indexHtml = fs.readFileSync(RESEARCH_INDEX, 'utf8');
        
        // Find the closing </div> of research-grid
        const gridEndMatch = indexHtml.match(/(<\/a>\s*<\/div>\s*<\/main>)/);
        if (!gridEndMatch) {
            log('Could not find insertion point in research index');
            return false;
        }
        
        const today = new Date().toLocaleDateString('en-US', { 
            year: 'numeric', month: 'long', day: 'numeric' 
        });
        
        const newCard = `
            <a href="/research-${theme.id}.html" class="research-card">
                <div class="icon">${theme.icon}</div>
                <h2>${theme.name}</h2>
                <p>Auto-generated research from collective learnings on ${theme.keywords.slice(0, 3).join(', ')}.</p>
                <span class="date">${today}</span>
            </a>
        `;
        
        // Insert before the grid closing
        indexHtml = indexHtml.replace(
            /(<\/a>\s*)(<\/div>\s*<\/main>)/,
            `$1${newCard}$2`
        );
        
        fs.writeFileSync(RESEARCH_INDEX, indexHtml);
        log(`Updated research index with ${theme.name}`);
        return true;
    } catch (err) {
        log(`Error updating index: ${err.message}`);
        return false;
    }
}

async function main() {
    log('=== Research Generator Started ===');
    
    // Load all learnings
    const allLearnings = await loadLearnings();
    log(`Loaded ${allLearnings.length} total learnings`);
    
    // Get recent ones
    const recentLearnings = getRecentLearnings(allLearnings, 14);
    log(`Found ${recentLearnings.length} learnings from last 14 days`);
    
    if (recentLearnings.length < 5) {
        log('Not enough recent learnings, using all learnings');
    }
    
    const learningsToUse = recentLearnings.length >= 5 ? recentLearnings : allLearnings;
    
    // Find candidates
    const candidates = findThemeCandidates(learningsToUse);
    log(`Found ${candidates.length} theme candidates`);
    
    if (candidates.length === 0) {
        log('No new research pages to generate');
        return;
    }
    
    // Generate ONE page per run (to avoid overwhelming)
    const candidate = candidates[0];
    log(`Generating research page for: ${candidate.theme.name}`);
    
    const content = await generateResearchPage(candidate);
    if (!content) {
        log('Failed to generate content');
        return;
    }
    
    // Build full page
    const fullPage = buildFullPage(candidate.theme, content);
    
    // Write page
    const filename = `research-${candidate.theme.id}.html`;
    const filepath = path.join(RESEARCH_DIR, filename);
    fs.writeFileSync(filepath, fullPage);
    log(`Wrote ${filename} (${fullPage.length} bytes)`);
    
    // Update index
    updateResearchIndex(candidate.theme);
    
    log(`=== Research Generator Complete: Created ${candidate.theme.name} ===`);
}

main().catch(err => {
    log(`Fatal error: ${err.message}`);
    process.exit(1);
});
