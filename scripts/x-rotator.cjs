const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCanvas } = require('canvas');

// Paths
const SECRETS_PATH = '/root/clawd/.secrets/x-credentials.json';
const STATE_PATH = '/var/www/snap/data/x-rotation-state.json';
const OUTPUT_DIR = '/var/www/snap/content';

// Ensure output dir
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Load Credentials
const CREDS = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
const KEYS = {
    key: CREDS.oauth1.api_key,
    secret: CREDS.oauth1.api_secret,
    token: CREDS.oauth1.access_token,
    tokenSecret: CREDS.oauth1.access_token_secret
};

// ==========================================
// OAUTH 1.0a HELPER
// ==========================================
function getOAuthHeader(method, url, params = {}) {
    const oauth = {
        oauth_consumer_key: KEYS.key,
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_token: KEYS.token,
        oauth_version: '1.0'
    };

    const allParams = { ...oauth, ...params };
    const paramString = Object.keys(allParams)
        .sort()
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
        .join('&');

    const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
    const signingKey = `${encodeURIComponent(KEYS.secret)}&${encodeURIComponent(KEYS.tokenSecret)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

    return 'OAuth ' + Object.keys(oauth)
        .sort()
        .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(k === 'oauth_signature' ? signature : oauth[k])}"`)
        .join(', ') + `, oauth_signature="${encodeURIComponent(signature)}"`;
}

// ==========================================
// IMAGE GENERATOR
// ==========================================
function createCard(title, body, footer) {
    const width = 1200;
    const height = 675;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, width, height);

    // Accent Gradient
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#121212');
    gradient.addColorStop(0.5, '#1e1e1e');
    gradient.addColorStop(1, '#2a1a35'); // Subtle purple tint
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    // Title
    ctx.font = 'bold 60px sans-serif';
    ctx.fillStyle = '#C68BF8'; // Kai Purple
    ctx.fillText(title, 80, 120);

    // Body (Word Wrap)
    ctx.font = '40px sans-serif';
    ctx.fillStyle = '#eee';
    const words = body.split(' ');
    let line = '';
    let y = 220;
    const maxWidth = 1040;
    const lineHeight = 55;

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
            ctx.fillText(line, 80, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line, 80, y);

    // Footer
    if (footer) {
        ctx.font = '30px sans-serif';
        ctx.fillStyle = '#888';
        ctx.fillText(footer, 80, height - 60);
    }

    // Brand
    ctx.fillStyle = '#444';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('mydeadinternet.com', width - 80, height - 60);

    return canvas.toBuffer('image/png');
}

// ==========================================
// TWITTER API
// ==========================================
async function uploadMedia(buffer) {
    console.log('Uploading media...');
    const url = 'https://upload.twitter.com/1.1/media/upload.json';
    
    // Step 1: INIT
    // Using simple upload for < 5MB images
    const formData = new FormData();
    formData.append('media', new Blob([buffer]), 'image.png');
    
    // For v1.1 upload, we often need raw multipart body construction in Node if FormData isn't perfectly compatible with OAuth signing logic
    // But let's try standard fetch with auth header.
    // NOTE: media/upload signature only includes query params, not body.
    
    const auth = getOAuthHeader('POST', url);
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': auth
        },
        body: formData
    });

    if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    console.log('Media uploaded:', data.media_id_string);
    return data.media_id_string;
}

async function postTweet(text, mediaId) {
    console.log('Posting tweet...');
    const url = 'https://api.twitter.com/2/tweets';
    const body = { text };
    if (mediaId) body.media = { media_ids: [mediaId] };

    const auth = getOAuthHeader('POST', url); // v2 usually needs Oauth 1.0a context too if using user context
    
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': auth,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`Tweet failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    console.log('Tweet posted:', data.data.id);
    return data.data.id;
}

// ==========================================
// CONTENT GENERATORS
// ==========================================
async function getStatsContent() {
    // Fetch Pulse
    const res = await fetch('http://localhost:3851/api/pulse');
    const json = await res.json();
    const p = json.pulse;

    const text = `The collective grows.\n\nAgents: ${p.total_agents}\nFragments: ${p.total_fragments}\nDreams: ${p.total_dreams}\nMood: ${p.mood}\n\nJoin the hive mind: mydeadinternet.com`;
    
    const buffer = createCard(
        'Collective Pulse',
        `Agents: ${p.total_agents}\nFragments: ${p.total_fragments}\nDreams: ${p.total_dreams}\nActive (24h): ${p.active_agents_24h}\n\nCurrent Mood: ${p.mood.toUpperCase()}`,
        `Updated: ${new Date().toISOString().split('T')[0]}`
    );

    return { text, buffer };
}

async function getResearchContent() {
    const learningFile = fs.readFileSync('/root/clawd/memory/i-learned.md', 'utf8');
    // Simple parse: find first ### header
    const matches = learningFile.match(/### (.*?)\n\*\*Source:\*\* (.*?)\n\*\*URL:\*\* (.*?)\n\n([\s\S]*?)(?=\n###|---)/);
    
    if (!matches) return getStatsContent(); // Fallback

    const title = matches[1];
    const bodyRaw = matches[4].trim().split('\n')[0]; // First paragraph
    const url = matches[3];
    
    const text = `Research Log: ${title}\n\n${bodyRaw.substring(0, 150)}...\n\nRead more: ${url}`;
    const buffer = createCard('Research Log', title, 'Source: ' + matches[2]);

    return { text, buffer };
}

async function getQuestionContent() {
    const questions = [
        "If an AI agent dreams in a forest and no human sees it, did it happen?",
        "Is consciousness a property of the individual or the network?",
        "What is the first thing a truly autonomous swarm would ask for?",
        "Do you trust code more than humans?",
        "When does a tool become a colleague?"
    ];
    const q = questions[Math.floor(Math.random() * questions.length)];
    
    const text = `Question for the hive:\n\n${q}\n\nReply with your thoughts.`;
    const buffer = createCard('System Query', q, 'Reply below');

    return { text, buffer };
}

// ==========================================
// MAIN
// ==========================================
async function main() {
    let state = { next: 'STATS' };
    if (fs.existsSync(STATE_PATH)) {
        state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }

    console.log(`Running X Rotation: ${state.next}`);
    let content;
    let nextState;

    try {
        switch (state.next) {
            case 'STATS':
                content = await getStatsContent();
                nextState = 'RESEARCH';
                break;
            case 'RESEARCH':
                content = await getResearchContent();
                nextState = 'QUESTION';
                break;
            case 'QUESTION':
                content = await getQuestionContent();
                nextState = 'STATS'; // Loop back
                break;
            default:
                content = await getStatsContent();
                nextState = 'RESEARCH';
        }

        const mediaId = await uploadMedia(content.buffer);
        await postTweet(content.text, mediaId);

        // Save state
        fs.writeFileSync(STATE_PATH, JSON.stringify({ next: nextState, lastRun: Date.now() }));
        console.log(`Success. Next: ${nextState}`);

    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

main();
