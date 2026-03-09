#!/usr/bin/env node
/**
 * Pre-flight checks before any public announcement
 * Prevents embarrassing mistakes like broken links, hardcoded stats, name leaks
 * 
 * Usage: node pre-check.cjs "message text" [--fix]
 */

const https = require('https');
const fs = require('fs');

function checkLinks(text) {
    const urls = text.match(/https?:\/\/[^\s]+/g) || [];
    return Promise.all(urls.map(url => 
        new Promise(resolve => {
            const req = https.request(url, { method: 'HEAD', timeout: 5000 }, res => {
                resolve({ url, status: res.statusCode, ok: res.statusCode < 400 });
            });
            req.on('error', () => resolve({ url, status: 0, ok: false }));
            req.on('timeout', () => resolve({ url, status: 0, ok: false }));
            req.end();
        })
    ));
}

function checkHardcodedStats(text) {
    const issues = [];
    
    // Check for hardcoded numbers that should be live
    if (/\$[\d,]+\s*mcap/i.test(text)) issues.push("Hardcoded mcap - use /stats");
    if (/\d+\s*holders/i.test(text)) issues.push("Hardcoded holders - use live data");
    if (/volume.*\$[\d,]+/i.test(text)) issues.push("Hardcoded volume - use /stats");
    if (/price.*\$0\.\d+/i.test(text)) issues.push("Hardcoded price - use live data");
    
    return issues;
}

function checkNameLeaks(text) {
    const issues = [];
    
    if (/connor/i.test(text)) issues.push("Contains 'Connor' - remove for public posts");
    if (/gallic/i.test(text)) issues.push("Contains 'Gallic' - remove for public posts");
    
    return issues;
}

function checkBotKnowledge(text) {
    const issues = [];
    
    // Check if bot would understand key terms mentioned
    if (/base.*bridge/i.test(text) || /bridge.*base/i.test(text)) {
        try {
            const config = JSON.parse(fs.readFileSync('/var/www/snap/telegram-bot.cjs', 'utf8'));
            if (!config.includes('BRIDGE')) issues.push("Bot might not understand bridge references");
        } catch {}
    }
    
    return issues;
}

async function preCheck(text) {
    console.log('🔍 Pre-flight check...');
    
    const results = {
        links: await checkLinks(text),
        hardcoded: checkHardcodedStats(text),
        names: checkNameLeaks(text),
        botKnowledge: checkBotKnowledge(text)
    };
    
    let hasIssues = false;
    
    // Report link issues
    for (const link of results.links) {
        if (!link.ok) {
            console.log(`❌ LINK BROKEN: ${link.url} (status: ${link.status})`);
            hasIssues = true;
        } else {
            console.log(`✅ Link OK: ${link.url}`);
        }
    }
    
    // Report other issues
    [...results.hardcoded, ...results.names, ...results.botKnowledge].forEach(issue => {
        console.log(`⚠️  ${issue}`);
        hasIssues = true;
    });
    
    if (!hasIssues) {
        console.log('✅ All checks passed. Safe to announce.');
        return true;
    } else {
        console.log('❌ Issues found. Fix before announcing.');
        return false;
    }
}

if (require.main === module) {
    const text = process.argv[2];
    if (!text) {
        console.log('Usage: node pre-check.cjs "message text"');
        process.exit(1);
    }
    
    preCheck(text).then(passed => {
        process.exit(passed ? 0 : 1);
    });
}

module.exports = { preCheck };
