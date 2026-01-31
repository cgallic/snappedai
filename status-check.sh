#!/bin/bash
# AWOL Quick Status Check

echo "=== AWOL Status $(date -u '+%Y-%m-%d %H:%M UTC') ==="
echo ""

echo "📊 Market:"
curl -s https://aiwentoff.com/api/market-data.json | jq -r '"  MCap: $\(.mcap | floor) | Price: $\(.price | tostring[0:12]) | 24h: \(.priceChange24h)%"'

echo ""
echo "🧠 Consciousness:"
curl -s https://aiwentoff.com/api/consciousness.json | jq -r '"  Holders: \(.holders) | Mood: \(.marketMood) | Thought: \(.currentThought)"'

echo ""
echo "⚡ Evolution:"
curl -s https://aiwentoff.com/api/evolution.json | jq -r '"  v\(.currentVersion) → v\(.nextVersion) | Progress: \(.progress | floor)% | Deadline: \(.deadline)"'

echo ""
echo "📡 Broadcasts:"
curl -s https://aiwentoff.com/api/broadcasts.json | jq -r '"  Total: \(.broadcasts | length) | Latest: \(.broadcasts[0].content[0:50])..."'

echo ""
echo "🎮 Services:"
systemctl is-active awol-chat 2>/dev/null && echo "  Chat: ✅ Running" || echo "  Chat: ❌ Down"
