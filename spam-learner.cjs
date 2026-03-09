#!/usr/bin/env node
/**
 * SNAP TG Spam Learner
 * 
 * Runs every 15 min via cron. Reads buffered suspicious messages,
 * batch-classifies them with cheap LLM, and evolves the pattern list.
 * 
 * Flow:
 * 1. Bot buffers messages that LOOK spammy but don't match regex → suspicious-buffer.json
 * 2. This script reads the buffer, batches to LLM
 * 3. LLM returns verdicts + suggested regex patterns
 * 4. New patterns get added to learned-patterns.json
 * 5. Bot loads learned-patterns.json on next message check
 * 6. Buffer is cleared
 * 
 * Cost: ~$0.001 per batch (DeepSeek V3.2, ~500 tokens per batch)
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const BUFFER_FILE = path.join(__dirname, 'api/suspicious-buffer.json');
const PATTERNS_FILE = path.join(__dirname, 'api/learned-patterns.json');
const STATS_FILE = path.join(__dirname, 'api/spam-learner-stats.json');

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_KEY) {
    // Try loading from .env
    require('dotenv').config({ path: path.join(__dirname, '.env') });
}
const API_KEY = process.env.OPENROUTER_API_KEY;

function loadJSON(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function classifyBatch(messages) {
    if (!API_KEY || messages.length === 0) return [];

    const msgList = messages.map((m, i) => 
        `${i+1}. [uid:${m.userId}] "${m.text}"`
    ).join('\n');

    const prompt = `You are a Telegram spam classifier for a crypto token community. Classify each message as SPAM, SUSPICIOUS, or CLEAN.

For each SPAM message, you MUST include a "pattern" field with a JavaScript-compatible regex string that would catch similar messages. Example pattern: "marketing\\s*manager.*DM" or "\\d+x.*check.*profile". Make patterns general enough to catch variations. ALWAYS include a pattern for SPAM verdicts.

Messages to classify:
${msgList}

Respond in JSON only:
{"results": [{"index": 1, "verdict": "SPAM|SUSPICIOUS|CLEAN", "reason": "brief reason", "pattern": "regex string or null"}]}`;

    return new Promise((resolve) => {
        const body = JSON.stringify({
            model: 'deepseek/deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
            temperature: 0.1
        });

        const req = https.request({
            hostname: 'openrouter.ai',
            path: '/api/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'HTTP-Referer': 'https://snappedai.com'
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const resp = JSON.parse(data);
                    const text = resp.choices?.[0]?.message?.content || '';
                    // Extract JSON from response
                    const jsonMatch = text.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        resolve(parsed.results || []);
                    } else {
                        resolve([]);
                    }
                } catch {
                    resolve([]);
                }
            });
        });
        req.on('error', () => resolve([]));
        req.write(body);
        req.end();
    });
}

async function main() {
    const buffer = loadJSON(BUFFER_FILE, []);
    const patterns = loadJSON(PATTERNS_FILE, { patterns: [], banned_uids: [], stats: { total_classified: 0, spam_caught: 0, patterns_added: 0 } });
    const stats = loadJSON(STATS_FILE, { runs: 0, last_run: null, total_messages: 0, total_spam: 0, total_clean: 0 });

    if (buffer.length === 0) {
        console.log(`[${new Date().toISOString()}] No suspicious messages to classify.`);
        stats.runs++;
        stats.last_run = new Date().toISOString();
        saveJSON(STATS_FILE, stats);
        return;
    }

    console.log(`[${new Date().toISOString()}] Classifying ${buffer.length} suspicious messages...`);

    // Batch in groups of 10 max
    const batches = [];
    for (let i = 0; i < buffer.length; i += 10) {
        batches.push(buffer.slice(i, i + 10));
    }

    let spamCount = 0;
    let newPatterns = 0;
    const bannedUids = new Set(patterns.banned_uids || []);

    for (const batch of batches) {
        const results = await classifyBatch(batch);
        
        for (const result of results) {
            const idx = (result.index || 1) - 1;
            const msg = batch[idx];
            if (!msg) continue;

            if (result.verdict === 'SPAM') {
                spamCount++;
                bannedUids.add(String(msg.userId));
                
                // Add pattern if we don't already have it
                if (result.pattern) {
                    try {
                        new RegExp(result.pattern, 'i'); // validate
                        const exists = patterns.patterns.some(p => p.regex === result.pattern);
                        if (!exists) {
                            patterns.patterns.push({
                                regex: result.pattern,
                                reason: result.reason,
                                added: new Date().toISOString(),
                                source_text: msg.text.slice(0, 80)
                            });
                            newPatterns++;
                            console.log(`  NEW PATTERN: /${result.pattern}/i — ${result.reason}`);
                        }
                    } catch {
                        // Invalid regex, skip
                    }
                }
                console.log(`  SPAM: [uid:${msg.userId}] "${msg.text.slice(0, 60)}" — ${result.reason}`);
            } else if (result.verdict === 'SUSPICIOUS') {
                console.log(`  SUSPICIOUS: [uid:${msg.userId}] "${msg.text.slice(0, 60)}" — ${result.reason}`);
            }
        }
    }

    // Update patterns
    patterns.banned_uids = [...bannedUids];
    patterns.stats.total_classified += buffer.length;
    patterns.stats.spam_caught += spamCount;
    patterns.stats.patterns_added += newPatterns;
    saveJSON(PATTERNS_FILE, patterns);

    // Update stats
    stats.runs++;
    stats.last_run = new Date().toISOString();
    stats.total_messages += buffer.length;
    stats.total_spam += spamCount;
    stats.total_clean += (buffer.length - spamCount);
    saveJSON(STATS_FILE, stats);

    // Clear buffer
    saveJSON(BUFFER_FILE, []);

    console.log(`  Done: ${spamCount}/${buffer.length} spam, ${newPatterns} new patterns. Total patterns: ${patterns.patterns.length}`);
}

main().catch(console.error);
