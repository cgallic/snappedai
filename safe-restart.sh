#!/bin/bash
# safe-restart.sh — Validate bot syntax before restarting
# Usage: ./safe-restart.sh [pm2-name]

PM2_NAME="${1:-snap-tg}"
BOT_SCRIPT="/var/www/snap/telegram-bot.cjs"
BACKUP_DIR="/var/www/snap/backups"

# 1. Syntax check
echo "🔍 Checking syntax..."
NODE_CHECK=$(node --check "$BOT_SCRIPT" 2>&1)
if [ $? -ne 0 ]; then
  echo "❌ Syntax error detected:"
  echo "$NODE_CHECK"
  echo ""
  
  # Find latest backup
  LATEST=$(ls -t "$BACKUP_DIR"/telegram-bot-*.cjs 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    echo "🔄 Reverting to: $LATEST"
    cp "$BOT_SCRIPT" "$BACKUP_DIR/broken-$(date +%s).cjs"
    cp "$LATEST" "$BOT_SCRIPT"
    echo "✅ Reverted. Restarting..."
    pm2 restart "$PM2_NAME"
  else
    echo "⚠️  No backup available. Fix manually."
    exit 1
  fi
  exit 1
fi

echo "✅ Syntax OK"

# 2. Create backup of current working version
TS=$(date +%Y%m%dT%H%M%S)
cp "$BOT_SCRIPT" "$BACKUP_DIR/telegram-bot-$TS.cjs"
echo "💾 Backup: telegram-bot-$TS.cjs"

# Keep only last 10
ls -t "$BACKUP_DIR"/telegram-bot-*.cjs | tail -n +11 | xargs rm -f 2>/dev/null

# 3. Restart
pm2 restart "$PM2_NAME"
echo "🚀 $PM2_NAME restarted"

# 4. Wait and verify
sleep 3
STATUS=$(pm2 jlist 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const p=JSON.parse(d).find(x=>x.name==='$PM2_NAME');
    console.log(p?.pm2_env?.status||'unknown')}catch{console.log('unknown')}
  })")

if [ "$STATUS" = "online" ]; then
  echo "✅ $PM2_NAME is online"
else
  echo "⚠️  Status: $STATUS — check logs"
  pm2 logs "$PM2_NAME" --lines 10 --nostream
fi
