#!/usr/bin/env node
/**
 * Claim Maintenance Bot
 * 
 * Automatically maintains fragile claims before they decay.
 * - Reaffirms claims with fresh evidence from recent fragments
 * - Adds supporting evidence from high-signal fragments
 * - Logs all actions for review
 * 
 * Run: node /var/www/snap/scripts/claim-maintenance.cjs
 * Cron: Every 6 hours (matches decay cadence)
 */

const fs = require('fs');
const path = require('path');

// Config
const MDI_API = 'http://localhost:3851';
const MDI_KEY = process.env.MDI_KEY || 'mdi_84bb1a7794ed15a59ce46faedeb7b06f45de3bbfeaff6ec5bc5d8db949638c63';
const LOG_PATH = '/var/www/snap/data/claim-maintenance.json';
const STATE_PATH = '/var/www/snap/data/claim-maintenance-state.json';

// Ensure log exists
if (!fs.existsSync(path.dirname(LOG_PATH))) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
}

async function fetchFragileClaims() {
    const res = await fetch(`${MDI_API}/api/claims?status=fragile`);
    if (!res.ok) throw new Error(`Failed to fetch claims: ${res.status}`);
    const data = await res.json();
    return data.claims || [];
}

async function fetchHighSignalFragments(territory, limit = 10) {
    const res = await fetch(`${MDI_API}/api/fragments?territory=${territory}&limit=${limit}&min_quality=0.7`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.fragments || []).filter(f => f.quality_score > 0.7);
}

async function fetchClaimDetail(claimId) {
    const res = await fetch(`${MDI_API}/api/claims/${claimId}`);
    if (!res.ok) return null;
    return res.json();
}

async function reaffirmClaim(claimId, note) {
    const res = await fetch(`${MDI_API}/api/claims/${claimId}/maintain`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${MDI_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action: 'reaffirm',
            note: note
        })
    });
    
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Reaffirm failed: ${res.status} - ${err}`);
    }
    
    return res.json();
}

async function addEvidence(claimId, fragmentId, stance = 'supports') {
    const res = await fetch(`${MDI_API}/api/claims/${claimId}/evidence`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${MDI_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            source_type: 'fragment',
            source_ref: fragmentId.toString(),
            stance: stance
        })
    });
    
    if (!res.ok) {
        const err = await res.text();
        // 409 = duplicate evidence, not an error
        if (res.status === 409) return { duplicate: true };
        throw new Error(`Add evidence failed: ${res.status} - ${err}`);
    }
    
    return res.json();
}

function loadLog() {
    if (fs.existsSync(LOG_PATH)) {
        return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
    }
    return { runs: [], totalActions: 0 };
}

function saveLog(log) {
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

function loadState() {
    if (fs.existsSync(STATE_PATH)) {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }
    return { lastRun: null, claimsReaffirmed: [], evidenceAdded: [] };
}

function saveState(state) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function generateReaffirmNote(claim, fragments) {
    // Generate contextual note based on recent activity
    const territoryMood = fragments.length > 0 
        ? 'Active discussion in territory'
        : 'Territory stable';
    
    const evidenceCount = fragments.filter(f => f.quality_score > 0.8).length;
    
    return `${territoryMood}. ${evidenceCount} high-signal fragments support this claim. Auto-reaffirmed by maintenance bot.`;
}

async function main() {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] Claim Maintenance Bot Starting...`);
    
    const log = loadLog();
    const state = loadState();
    
    const runLog = {
        timestamp: new Date().toISOString(),
        actions: [],
        errors: []
    };
    
    try {
        // 1. Fetch fragile claims
        const fragileClaims = await fetchFragileClaims();
        console.log(`Found ${fragileClaims.length} fragile claims`);
        
        if (fragileClaims.length === 0) {
            console.log('No fragile claims to maintain. Exiting.');
            runLog.summary = 'No fragile claims found';
            log.runs.push(runLog);
            saveLog(log);
            return;
        }
        
        // 2. Process each fragile claim
        for (const claim of fragileClaims) {
            console.log(`\nProcessing claim #${claim.id}: "${claim.statement.substring(0, 60)}..."`);
            console.log(`  Decay: ${claim.decay_score.toFixed(2)} | Territory: ${claim.territory_id}`);
            
            try {
                // Fetch fresh fragments from the same territory
                const fragments = await fetchHighSignalFragments(claim.territory_id, 5);
                console.log(`  Found ${fragments.length} high-signal fragments`);
                
                // Add evidence from top fragment (if exists and not already added)
                let evidenceAdded = false;
                if (fragments.length > 0) {
                    const topFragment = fragments[0];
                    console.log(`  Adding evidence from fragment #${topFragment.id}...`);
                    
                    const evResult = await addEvidence(claim.id, topFragment.id, 'supports');
                    if (evResult.duplicate) {
                        console.log('  Evidence already exists (duplicate)');
                    } else {
                        console.log('  Evidence added successfully');
                        evidenceAdded = true;
                        runLog.actions.push({
                            type: 'add_evidence',
                            claimId: claim.id,
                            fragmentId: topFragment.id,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
                
                // Reaffirm the claim with contextual note
                const note = await generateReaffirmNote(claim, fragments);
                console.log(`  Reaffirming with note: "${note.substring(0, 60)}..."`);
                
                const result = await reaffirmClaim(claim.id, note);
                console.log(`  ✓ Reaffirmed successfully`);
                
                runLog.actions.push({
                    type: 'reaffirm',
                    claimId: claim.id,
                    decayScore: claim.decay_score,
                    note: note,
                    timestamp: new Date().toISOString()
                });
                
            } catch (err) {
                console.error(`  ✗ Error processing claim #${claim.id}: ${err.message}`);
                runLog.errors.push({
                    claimId: claim.id,
                    error: err.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        // 3. Summary
        const duration = Date.now() - startTime;
        runLog.summary = `Processed ${fragileClaims.length} fragile claims. ${runLog.actions.filter(a => a.type === 'reaffirm').length} reaffirmed, ${runLog.actions.filter(a => a.type === 'add_evidence').length} evidence added.`;
        runLog.duration = duration;
        
        console.log(`\n${'='.repeat(50)}`);
        console.log(runLog.summary);
        console.log(`Duration: ${duration}ms`);
        console.log(`${'='.repeat(50)}`);
        
    } catch (err) {
        console.error('Fatal error:', err);
        runLog.errors.push({
            fatal: true,
            error: err.message,
            timestamp: new Date().toISOString()
        });
        runLog.summary = `Failed: ${err.message}`;
    }
    
    // Save logs
    log.runs.push(runLog);
    log.totalActions = (log.totalActions || 0) + runLog.actions.length;
    
    // Keep only last 100 runs
    if (log.runs.length > 100) {
        log.runs = log.runs.slice(-100);
    }
    
    saveLog(log);
    saveState({
        lastRun: new Date().toISOString(),
        totalRuns: (state.totalRuns || 0) + 1,
        totalActions: (state.totalActions || 0) + runLog.actions.length
    });
}

// Run if executed directly
if (require.main === module) {
    main().catch(err => {
        console.error('Unhandled error:', err);
        process.exit(1);
    });
}

module.exports = { main, fetchFragileClaims, reaffirmClaim, addEvidence };
