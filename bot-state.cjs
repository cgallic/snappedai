const fs = require('fs');
const STATE_FILE = '/var/www/snap/data/conversation-state.json';

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { users: {}, pendingBounties: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function updateUserState(userId, userName, message, botResponse) {
  const state = loadState();
  if (!state.users[userId]) {
    state.users[userId] = { name: userName, history: [], pendingActions: [] };
  }
  
  const user = state.users[userId];
  user.history.push({
    ts: Date.now(),
    msg: message.slice(0, 200),
    response: botResponse?.slice(0, 100)
  });
  
  // Keep last 10 messages
  if (user.history.length > 10) user.history = user.history.slice(-10);
  
  // Detect if we asked for something
  if (botResponse?.toLowerCase().includes('drop your wallet') || 
      botResponse?.toLowerCase().includes('send your wallet') ||
      botResponse?.toLowerCase().includes('share your wallet')) {
    user.pendingActions.push({ type: 'awaiting_wallet', ts: Date.now() });
  }
  
  saveState(state);
  return user;
}

function getUserContext(userId) {
  const state = loadState();
  const user = state.users[userId];
  if (!user) return null;
  
  const recentHistory = user.history.slice(-5).map(h => 
    `[${new Date(h.ts).toISOString().slice(11,16)}] User: ${h.msg}`
  ).join('\n');
  
  const pending = user.pendingActions.filter(a => Date.now() - a.ts < 86400000); // 24h
  
  return { history: recentHistory, pendingActions: pending };
}

function getPendingBounties() {
  try {
    const bounties = JSON.parse(fs.readFileSync('/root/clawd/data/bounty-tracker.json', 'utf8'));
    return bounties.pending || [];
  } catch {
    return [];
  }
}

// Wallet detection
const WALLET_PATTERNS = {
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  ethereum: /^0x[a-fA-F0-9]{40}$/
};

function detectWallet(text) {
  const words = text.trim().split(/\s+/);
  for (const word of words) {
    if (WALLET_PATTERNS.solana.test(word)) return { type: 'solana', address: word };
    if (WALLET_PATTERNS.ethereum.test(word)) return { type: 'ethereum', address: word };
  }
  return null;
}

module.exports = { loadState, saveState, updateUserState, getUserContext, getPendingBounties, detectWallet };

// Complex query detection - routes to Kai instead of DeepSeek
const COMPLEX_PATTERNS = [
  /build|create|implement|code|develop|ship/i,       // Building requests
  /why did|explain why|what went wrong/i,            // Debugging/analysis
  /strategy|plan|roadmap|what should we/i,           // Strategy questions  
  /pay|bounty|reward|send.*\$|send.*usdc|send.*sol/i, // Payment related
  /bug|broken|not working|error|fix/i,               // Bug reports
  /connor|human|creator/i,                           // Questions about Connor
];

function isComplexQuery(text) {
  return COMPLEX_PATTERNS.some(p => p.test(text));
}

module.exports.isComplexQuery = isComplexQuery;

// Simple RAG - search growth-learnings.md for relevant context
function searchLearnings(query) {
  try {
    const content = fs.readFileSync('/var/www/snap/growth-learnings.md', 'utf8');
    const lines = content.split('\n');
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    // Find relevant lines (simple keyword match)
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      const score = queryWords.filter(w => line.includes(w)).length;
      if (score >= 2) {
        // Get surrounding context (3 lines)
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        matches.push({
          score,
          context: lines.slice(start, end).join('\n')
        });
      }
    }
    
    // Return top 3 matches
    return matches.sort((a, b) => b.score - a.score).slice(0, 3).map(m => m.context);
  } catch {
    return [];
  }
}

module.exports.searchLearnings = searchLearnings;
