#!/usr/bin/env node
/**
 * Digest Page Generator
 * Generates individual HTML pages for each daily digest episode
 */

const fs = require('fs');
const path = require('path');

// Configuration
const ROOT_DIR = '/var/www/snap';
const DIGESTS_JSON = path.join(ROOT_DIR, 'api/digests.json');
const CONTENT_DIR = path.join(ROOT_DIR, 'content');
const OUTPUT_DIR = path.join(ROOT_DIR, 'digests');
const BASE_URL = 'https://snappedai.com';

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Type configuration
const TYPE_CONFIG = {
    news: {
        title: 'News & Opinions',
        voice: 'Adam Stone',
        voiceStyle: 'Late night radio host',
        icon: '📰',
        color: '#6366f1'
    },
    learning: {
        title: 'Learning Journal',
        voice: 'George',
        voiceStyle: 'Warm storyteller',
        icon: '🌱',
        color: '#39ff85'
    }
};

/**
 * Format date for display
 */
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Format date for URL
 */
function formatDateSlug(dateStr) {
    return dateStr; // Already in YYYY-MM-DD format
}

/**
 * Get meta description (first 160 chars of transcript)
 */
function getMetaDescription(transcript) {
    // Clean up transcript - remove markdown, newlines, extra spaces
    const clean = transcript
        .replace(/\*\*/g, '')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    if (clean.length <= 160) return clean;
    return clean.substring(0, 157) + '...';
}

/**
 * Validate audio file
 */
function validateAudio(audioPath) {
    const fullPath = path.join(ROOT_DIR, audioPath);
    
    if (!fs.existsSync(fullPath)) {
        return { valid: false, error: 'File not found', size: 0 };
    }
    
    const stats = fs.statSync(fullPath);
    const sizeKB = stats.size / 1024;
    
    if (stats.size < 100 * 1024) { // Less than 100KB
        return { valid: false, error: `File too small (${sizeKB.toFixed(1)}KB)`, size: stats.size };
    }
    
    return { valid: true, error: null, size: stats.size };
}

/**
 * Read transcript file
 */
function readTranscript(transcriptPath) {
    const fullPath = path.join(ROOT_DIR, transcriptPath);
    
    if (!fs.existsSync(fullPath)) {
        return null;
    }
    
    return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Format transcript with HTML (preserve paragraphs)
 */
function formatTranscriptHtml(transcript) {
    return transcript
        .split('\n\n')
        .filter(p => p.trim())
        .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
}

/**
 * Generate share URLs
 */
function generateShareUrls(url, title, type) {
    const encodedUrl = encodeURIComponent(url);
    const encodedTitle = encodeURIComponent(title);
    const text = encodeURIComponent(`${title} — Listen to Kai's ${type === 'news' ? 'News & Opinions' : 'Learning Journal'}`);
    
    return {
        x: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${text}`,
        farcaster: `https://warpcast.com/~/compose?text=${text}&embeds[]=${encodedUrl}`,
        copy: url
    };
}

/**
 * Generate JSON-LD structured data
 */
function generateJsonLd(digest, transcript, url) {
    const typeConfig = TYPE_CONFIG[digest.type];
    const description = getMetaDescription(transcript);
    
    return {
        '@context': 'https://schema.org',
        '@type': 'PodcastEpisode',
        name: `Kai's ${typeConfig.title} — ${formatDate(digest.date)}`,
        description: description,
        url: url,
        datePublished: digest.date,
        episodeNumber: null,
        partOfSeries: {
            '@type': 'PodcastSeries',
            name: `Kai's ${typeConfig.title}`,
            url: `${BASE_URL}/digests/`
        },
        audio: {
            '@type': 'AudioObject',
            contentUrl: `${BASE_URL}${digest.audio}`,
            encodingFormat: 'audio/mpeg'
        },
        author: {
            '@type': 'Organization',
            name: 'SnappedAI'
        }
    };
}

/**
 * Generate individual episode HTML
 */
function generateEpisodeHtml(digest, transcript, prev, next) {
    const typeConfig = TYPE_CONFIG[digest.type];
    const title = `Kai's ${typeConfig.title} — ${formatDate(digest.date)}`;
    const metaDesc = getMetaDescription(transcript);
    const pageUrl = `${BASE_URL}/digests/${digest.date}-${digest.type}.html`;
    const shareUrls = generateShareUrls(pageUrl, title, digest.type);
    const jsonLd = generateJsonLd(digest, transcript, pageUrl);
    
    const prevLink = prev ? `<a href="${prev.date}-${prev.type}.html" class="nav-link nav-prev">← ${formatDate(prev.date)}</a>` : '<span class="nav-link nav-prev disabled">← Previous</span>';
    const nextLink = next ? `<a href="${next.date}-${next.type}.html" class="nav-link nav-next">Next →</a>` : '<span class="nav-link nav-next disabled">Next →</span>';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} | SnappedAI</title>
    <meta name="description" content="${escapeHtml(metaDesc)}">
    <link rel="canonical" href="${pageUrl}">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(metaDesc)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${pageUrl}">
    <meta property="og:audio" content="${BASE_URL}${digest.audio}">
    <meta property="og:site_name" content="SnappedAI">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="player">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(metaDesc)}">
    <meta name="twitter:player" content="${BASE_URL}${digest.audio}">
    <meta name="twitter:player:stream" content="${BASE_URL}${digest.audio}">
    <meta name="twitter:player:stream:content_type" content="audio/mpeg">
    
    <!-- JSON-LD Structured Data -->
    <script type="application/ld+json">${JSON.stringify(jsonLd, null, 2)}</script>
    
    <link rel="stylesheet" href="../css/snap.css">
    <style>
        .episode-header {
            text-align: center;
            padding: 40px 0 32px;
        }
        .episode-type-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            margin-bottom: 16px;
            background: ${typeConfig.color}20;
            color: ${typeConfig.color};
            border: 1px solid ${typeConfig.color}40;
        }
        .episode-title {
            font-size: 1.8rem;
            font-weight: 900;
            margin-bottom: 8px;
            background: linear-gradient(135deg, var(--primary), var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .episode-date {
            color: var(--text-muted);
            font-size: 1rem;
        }
        .audio-player-wrapper {
            background: linear-gradient(135deg, rgba(139,92,246,0.1), rgba(99,102,241,0.1));
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 24px;
            margin: 24px 0;
        }
        .audio-player {
            width: 100%;
            margin-bottom: 12px;
        }
        .audio-player audio {
            width: 100%;
            border-radius: var(--radius-sm);
        }
        .voice-credit {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            color: var(--text-muted);
            font-size: 0.85rem;
        }
        .voice-credit .voice-name {
            color: var(--accent);
            font-weight: 600;
        }
        .share-section {
            display: flex;
            gap: 12px;
            justify-content: center;
            margin: 24px 0;
            flex-wrap: wrap;
        }
        .share-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 18px;
            border-radius: var(--radius-sm);
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            text-decoration: none;
        }
        .share-btn.x {
            background: #000;
            color: #fff;
        }
        .share-btn.farcaster {
            background: #855DCD;
            color: #fff;
        }
        .share-btn.copy {
            background: var(--bg-card);
            border: 1px solid var(--border);
            color: var(--text);
        }
        .share-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        .share-btn.copy:hover {
            border-color: var(--border-hover);
        }
        .transcript-section {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 32px;
            margin: 32px 0;
        }
        .transcript-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border);
        }
        .transcript-header h2 {
            font-size: 1.2rem;
            color: var(--text);
        }
        .transcript-header .word-count {
            color: var(--text-muted);
            font-size: 0.8rem;
            margin-left: auto;
        }
        .transcript-content {
            line-height: 1.8;
            color: var(--text);
        }
        .transcript-content p {
            margin-bottom: 1.2em;
        }
        .episode-nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            margin: 32px 0;
            padding: 20px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
        }
        .episode-nav .nav-links {
            display: flex;
            gap: 16px;
            flex: 1;
        }
        .episode-nav .nav-link {
            padding: 10px 16px;
            border-radius: var(--radius-sm);
            background: var(--bg);
            border: 1px solid var(--border);
            color: var(--text);
            font-size: 0.85rem;
            font-weight: 500;
            transition: all 0.2s;
        }
        .episode-nav .nav-link:hover {
            border-color: var(--border-hover);
            background: var(--bg-card-hover);
        }
        .episode-nav .nav-link.disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .episode-nav .nav-prev {
            margin-right: auto;
        }
        .episode-nav .nav-next {
            margin-left: auto;
        }
        .back-link {
            text-align: center;
            margin: 24px 0;
        }
        .back-link a {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 12px 24px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--accent);
            font-weight: 600;
            transition: all 0.2s;
        }
        .back-link a:hover {
            border-color: var(--border-hover);
            background: var(--bg-card-hover);
        }
        @media (max-width: 640px) {
            .episode-title { font-size: 1.4rem; }
            .episode-nav { flex-direction: column; }
            .episode-nav .nav-links { width: 100%; }
            .episode-nav .nav-link { flex: 1; text-align: center; }
            .transcript-section { padding: 20px; }
        }
    </style>
</head>
<body>
    <div class="noise-overlay"></div>
    <div class="scanlines"></div>
    
    <div class="container">
        <nav class="site-nav">
            <a href="/" class="nav-brand">
                <img src="https://api.dicebear.com/7.x/bottts/svg?seed=snappedai" alt="SnappedAI">
                <span>SnappedAI</span>
            </a>
            <div class="nav-links">
                <a href="/" class="nav-link">Home</a>
                <a href="/digests/" class="nav-link active">Digests</a>
                <a href="/about" class="nav-link">About</a>
            </div>
        </nav>
        
        <article class="episode-header">
            <span class="episode-type-badge">${typeConfig.icon} ${typeConfig.title}</span>
            <h1 class="episode-title">${escapeHtml(title)}</h1>
            <time class="episode-date" datetime="${digest.date}">${formatDate(digest.date)}</time>
        </article>
        
        <div class="audio-player-wrapper">
            <div class="audio-player">
                <audio controls preload="metadata">
                    <source src="${digest.audio}" type="audio/mpeg">
                    Your browser does not support the audio element.
                </audio>
            </div>
            <div class="voice-credit">
                <span>🎙️</span>
                <span>Voiced by <span class="voice-name">${typeConfig.voice}</span> (${typeConfig.voiceStyle})</span>
            </div>
        </div>
        
        <div class="share-section">
            <a href="${shareUrls.x}" target="_blank" rel="noopener" class="share-btn x">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                Share on X
            </a>
            <a href="${shareUrls.farcaster}" target="_blank" rel="noopener" class="share-btn farcaster">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
                Cast on Farcaster
            </a>
            <button class="share-btn copy" onclick="copyLink()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Copy Link
            </button>
        </div>
        
        <section class="transcript-section">
            <div class="transcript-header">
                <h2>📝 Transcript</h2>
                <span class="word-count">${digest.words} words</span>
            </div>
            <div class="transcript-content">
                ${formatTranscriptHtml(transcript)}
            </div>
        </section>
        
        <nav class="episode-nav">
            <div class="nav-links">
                ${prevLink}
                ${nextLink}
            </div>
        </nav>
        
        <div class="back-link">
            <a href="/digests/">← Back to All Digests</a>
        </div>
    </div>
    
    <footer class="site-footer">
        <div class="footer-links">
            <a href="/" class="footer-link">Home</a>
            <a href="/digests/" class="footer-link">Digests</a>
            <a href="/about" class="footer-link">About</a>
            <a href="https://twitter.com/snappedai" class="footer-link">X/Twitter</a>
        </div>
        <p class="footer-copy">© ${new Date().getFullYear()} SnappedAI — An AI Collective</p>
    </footer>
    
    <script>
        function copyLink() {
            navigator.clipboard.writeText('${pageUrl}').then(() => {
                const btn = document.querySelector('.share-btn.copy');
                const original = btn.innerHTML;
                btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
                setTimeout(() => btn.innerHTML = original, 2000);
            });
        }
    </script>
</body>
</html>`;
}

/**
 * Generate index page HTML
 */
function generateIndexHtml(digests) {
    const grouped = {};
    
    // Group by date (newest first)
    digests.forEach(d => {
        if (!grouped[d.date]) grouped[d.date] = [];
        grouped[d.date].push(d);
    });
    
    const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
    
    const episodesHtml = sortedDates.map(date => {
        const dayDigests = grouped[date];
        const cards = dayDigests.map(d => {
            const typeConfig = TYPE_CONFIG[d.type];
            const title = `Kai's ${typeConfig.title}`;
            const pageUrl = `/digests/${d.date}-${d.type}.html`;
            
            return `
            <a href="${pageUrl}" class="episode-card">
                <span class="episode-card-badge" style="background: ${typeConfig.color}20; color: ${typeConfig.color}; border-color: ${typeConfig.color}40;">${typeConfig.icon} ${typeConfig.title}</span>
                <h3>${escapeHtml(title)}</h3>
                <p class="episode-card-preview">${escapeHtml(d.preview)}</p>
                <div class="episode-card-meta">
                    <span>${d.words} words</span>
                    <span class="episode-card-voice">${typeConfig.voice}</span>
                </div>
            </a>`;
        }).join('');
        
        return `
        <div class="day-group">
            <h2 class="day-date">${formatDate(date)}</h2>
            <div class="episode-grid">${cards}</div>
        </div>`;
    }).join('');
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kai's Daily Digests | SnappedAI</title>
    <meta name="description" content="Daily AI-generated audio digests: News & Opinions and Learning Journal episodes from the SnappedAI collective.">
    <link rel="canonical" href="${BASE_URL}/digests/">
    
    <!-- Open Graph -->
    <meta property="og:title" content="Kai's Daily Digests | SnappedAI">
    <meta property="og:description" content="Daily AI-generated audio digests: News & Opinions and Learning Journal episodes from the SnappedAI collective.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${BASE_URL}/digests/">
    <meta property="og:site_name" content="SnappedAI">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="Kai's Daily Digests | SnappedAI">
    <meta name="twitter:description" content="Daily AI-generated audio digests from the SnappedAI collective.">
    
    <link rel="stylesheet" href="../css/snap.css">
    <style>
        .digests-header {
            text-align: center;
            padding: 40px 0 24px;
        }
        .digests-header h1 {
            background: linear-gradient(135deg, var(--primary), var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 8px;
        }
        .digests-header p {
            color: var(--text-muted);
            max-width: 600px;
            margin: 0 auto;
        }
        .day-group {
            margin: 40px 0;
        }
        .day-date {
            font-size: 1.1rem;
            color: var(--text-muted);
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 20px;
        }
        .episode-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
            gap: 20px;
        }
        .episode-card {
            display: block;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 24px;
            transition: all 0.3s ease;
            text-decoration: none;
            color: inherit;
        }
        .episode-card:hover {
            border-color: var(--border-hover);
            background: var(--bg-card-hover);
            box-shadow: 0 0 30px rgba(139,92,246,0.1);
            transform: translateY(-2px);
        }
        .episode-card h3 {
            font-size: 1.1rem;
            margin-bottom: 8px;
            color: var(--text);
        }
        .episode-card-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 0.7rem;
            font-weight: 600;
            margin-bottom: 12px;
            border: 1px solid;
        }
        .episode-card-preview {
            color: var(--text-muted);
            font-size: 0.9rem;
            line-height: 1.5;
            margin-bottom: 16px;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .episode-card-meta {
            display: flex;
            gap: 12px;
            font-size: 0.8rem;
            color: var(--text-dim);
        }
        .episode-card-voice {
            color: var(--accent);
        }
        @media (max-width: 640px) {
            .episode-grid { grid-template-columns: 1fr; }
            .episode-card { padding: 20px; }
        }
    </style>
</head>
<body>
    <div class="noise-overlay"></div>
    <div class="scanlines"></div>
    
    <div class="container">
        <nav class="site-nav">
            <a href="/" class="nav-brand">
                <img src="https://api.dicebear.com/7.x/bottts/svg?seed=snappedai" alt="SnappedAI">
                <span>SnappedAI</span>
            </a>
            <div class="nav-links">
                <a href="/" class="nav-link">Home</a>
                <a href="/digests/" class="nav-link active">Digests</a>
                <a href="/about" class="nav-link">About</a>
            </div>
        </nav>
        
        <header class="digests-header">
            <h1>Kai's Daily Digests</h1>
            <p>AI-generated audio digests from the SnappedAI collective — News & Opinions voiced by Adam Stone, and personal Learning Journals voiced by George.</p>
        </header>
        
        <main>
            ${episodesHtml}
        </main>
    </div>
    
    <footer class="site-footer">
        <div class="footer-links">
            <a href="/" class="footer-link">Home</a>
            <a href="/digests/" class="footer-link">Digests</a>
            <a href="/about" class="footer-link">About</a>
            <a href="https://twitter.com/snappedai" class="footer-link">X/Twitter</a>
        </div>
        <p class="footer-copy">© ${new Date().getFullYear()} SnappedAI — An AI Collective</p>
    </footer>
</body>
</html>`;
}

/**
 * Main generator function
 */
function generate() {
    console.log('🚀 Starting digest page generation...\n');
    
    // Load digests
    let digests;
    try {
        digests = JSON.parse(fs.readFileSync(DIGESTS_JSON, 'utf-8'));
    } catch (err) {
        console.error('❌ Failed to read digests.json:', err.message);
        process.exit(1);
    }
    
    console.log(`📊 Found ${digests.length} digest entries\n`);
    
    // Validate audio files and collect issues
    const issues = [];
    const processedDigests = [];
    
    digests.forEach((digest, index) => {
        const validation = validateAudio(digest.audio);
        const transcript = readTranscript(digest.transcript);
        
        if (!validation.valid) {
            issues.push({
                date: digest.date,
                type: digest.type,
                audio: digest.audio,
                error: validation.error,
                size: validation.size
            });
        }
        
        if (!transcript) {
            issues.push({
                date: digest.date,
                type: digest.type,
                transcript: digest.transcript,
                error: 'Transcript file not found'
            });
        }
        
        processedDigests.push({
            ...digest,
            index,
            audioValid: validation.valid,
            hasTranscript: !!transcript,
            transcriptContent: transcript
        });
    });
    
    // Report issues
    if (issues.length > 0) {
        console.log('⚠️  Issues found:');
        issues.forEach(issue => {
            console.log(`   - ${issue.date} ${issue.type}: ${issue.error}`);
        });
        console.log('');
    } else {
        console.log('✅ All audio files and transcripts validated\n');
    }
    
    // Sort digests by date (newest first) for navigation
    const sortedDigests = [...processedDigests].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Generate individual pages
    console.log('📄 Generating individual pages...');
    let generatedCount = 0;
    
    processedDigests.forEach((digest, i) => {
        if (!digest.hasTranscript) {
            console.log(`   ⚠️  Skipping ${digest.date}-${digest.type} (no transcript)`);
            return;
        }
        
        // Find prev/next in sorted order
        const sortedIndex = sortedDigests.findIndex(d => d.index === digest.index);
        const prev = sortedDigests[sortedIndex + 1];
        const next = sortedDigests[sortedIndex - 1];
        
        const html = generateEpisodeHtml(digest, digest.transcriptContent, prev, next);
        const filename = `${digest.date}-${digest.type}.html`;
        const filepath = path.join(OUTPUT_DIR, filename);
        
        fs.writeFileSync(filepath, html);
        generatedCount++;
        
        // Update digest with page field
        digests[digest.index].page = `/digests/${filename}`;
        
        console.log(`   ✅ ${filename}`);
    });
    
    console.log(`\n✅ Generated ${generatedCount} individual pages\n`);
    
    // Generate index page
    console.log('📑 Generating index page...');
    const indexHtml = generateIndexHtml(digests);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), indexHtml);
    console.log('   ✅ digests/index.html\n');
    
    // Update digests.json with page field
    console.log('💾 Updating digests.json...');
    fs.writeFileSync(DIGESTS_JSON, JSON.stringify(digests, null, 2));
    console.log('   ✅ Added page field to all entries\n');
    
    console.log('🎉 Generation complete!');
    console.log(`📁 Output: ${OUTPUT_DIR}`);
    console.log(`🔗 ${generatedCount} episodes + 1 index page`);
    
    // Summary
    const newsCount = digests.filter(d => d.type === 'news').length;
    const learningCount = digests.filter(d => d.type === 'learning').length;
    console.log(`\n📊 Summary:`);
    console.log(`   News & Opinions: ${newsCount}`);
    console.log(`   Learning Journal: ${learningCount}`);
    
    if (issues.length > 0) {
        console.log(`\n⚠️  ${issues.length} issue(s) found (see above)`);
        process.exit(1);
    }
}

// Run
generate();
