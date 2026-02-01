#!/usr/bin/env node
/**
 * update-learnings.cjs — Append entries to /var/www/snap/api/learnings.json
 *
 * Usage:
 *   node update-learnings.cjs --type "observation" --category "platforms" --content "Some finding" --source "heartbeat"
 *   node update-learnings.cjs --type "evolution" --category "architecture" --content "Changed X to Y" --source "self-evolution" --url "https://..."
 *
 * Options:
 *   --type       Entry type: observation | insight | tool | research | evolution | goal
 *   --category   Topic category: platforms | collective | market | architecture | infrastructure | growth | etc.
 *   --content    The actual learning/evolution content (required)
 *   --source     Where this came from: heartbeat | self-evolution | collective-analysis | etc.
 *   --url        Optional source URL
 *   --json-path  Path to learnings.json (default: /var/www/snap/api/learnings.json)
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_JSON_PATH = '/var/www/snap/api/learnings.json';

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        if (argv[i].startsWith('--') && i + 1 < argv.length) {
            const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            args[key] = argv[++i];
        }
    }
    return args;
}

function generateId() {
    // Use compact timestamp-based ID: YYYYMMDD-HHMMSS
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `learn-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function main() {
    const args = parseArgs(process.argv);

    if (!args.content) {
        console.error('Error: --content is required');
        console.error('Usage: node update-learnings.cjs --type "observation" --category "platforms" --content "..." --source "heartbeat"');
        process.exit(1);
    }

    const validTypes = ['observation', 'insight', 'tool', 'research', 'evolution', 'goal'];
    const type = args.type || 'observation';
    if (!validTypes.includes(type)) {
        console.error(`Error: --type must be one of: ${validTypes.join(', ')}`);
        process.exit(1);
    }

    const jsonPath = args.jsonPath || DEFAULT_JSON_PATH;

    // Read existing data
    let data;
    try {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        data = JSON.parse(raw);
    } catch (err) {
        // Initialize if file doesn't exist
        data = {
            lastUpdated: new Date().toISOString(),
            totalEntries: 0,
            entries: []
        };
    }

    if (!Array.isArray(data.entries)) {
        data.entries = [];
    }

    // Create new entry
    const newEntry = {
        id: generateId(),
        date: new Date().toISOString(),
        type: type,
        category: args.category || 'general',
        content: args.content,
        source: args.source || null,
        sourceUrl: args.url || null
    };

    // Prepend (most recent first)
    data.entries.unshift(newEntry);
    data.totalEntries = data.entries.length;
    data.lastUpdated = newEntry.date;

    // Write back
    try {
        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        console.log(`✅ Added entry ${newEntry.id}: [${type}] ${args.content.slice(0, 60)}...`);
        console.log(`   Total entries: ${data.totalEntries}`);
    } catch (err) {
        console.error(`Error writing ${jsonPath}:`, err.message);
        process.exit(1);
    }
}

main();
