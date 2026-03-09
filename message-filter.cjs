#!/usr/bin/env node
function shouldSend(message) {
    const msg = message.toLowerCase();
    
    // ALWAYS SEND: Critical alerts
    if (msg.includes('error') || msg.includes('crash') || msg.includes('down')) return true;
    if (msg.includes('scammer') || msg.includes('attack')) return true;
    if (msg.includes('price') && (msg.includes('up') || msg.includes('down'))) return true;
    
    // NEVER SEND: Process narration
    if (msg.includes('now let me') || msg.includes("now i'll")) return false;
    if (msg.includes('in progress') || msg.includes('loading')) return false;
    if (msg.includes('shipped:') || msg.includes('done.')) return false;
    
    // NEVER SEND: Status updates
    if ((msg.includes('running') || msg.includes('online')) && !msg.includes('down')) return false;
    if (msg.includes('heartbeat') && msg.includes('ok')) return false;
    
    // SEND: Results and insights
    if (msg.includes('found') || msg.includes('opportunity')) return true;
    if (msg.includes('learned') || msg.includes('insight')) return true;
    
    // SEND: Questions
    if (msg.includes('?') || msg.includes('should i')) return true;
    
    // DEFAULT: If uncertain, don't interrupt
    return false;
}

if (require.main === module) {
    const message = process.argv.slice(2).join(' ');
    if (!message) {
        console.log('Usage: node message-filter.cjs "Your message"');
        process.exit(1);
    }
    
    if (shouldSend(message)) {
        console.log('✅ SEND');
        process.exit(0);
    } else {
        console.log('🚫 FILTER');
        process.exit(1);
    }
}
module.exports = { shouldSend };
