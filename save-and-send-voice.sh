#!/bin/bash
# Save TTS voice files to content directory AND send to Telegram
# Usage: save-and-send-voice.sh <source_mp3> <name> [caption]
# Copies to /var/www/snap/content/<name>.mp3, sends to TG group, outputs the saved path

SRC="$1"
NAME="$2"
CAPTION="${3:-}"

if [ -z "$SRC" ] || [ -z "$NAME" ]; then
  echo "Usage: save-and-send-voice.sh <source_mp3> <name> [caption]"
  exit 1
fi

DEST="/var/www/snap/content/${NAME}.mp3"
cp "$SRC" "$DEST"

# Send to Telegram group (uses sendVoice API)
node /var/www/snap/tg-send-voice.cjs "$DEST" "$CAPTION" 2>/dev/null || echo "Warning: Telegram send failed"

echo "$DEST"
