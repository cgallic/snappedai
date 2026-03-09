#!/bin/bash
# Generate voice content using ElevenLabs v3 (supports [sighs], [whispers], etc.)
# Usage: ./voice-gen.sh "text with [tags]" output.mp3

set -e

TEXT="$1"
OUTPUT="${2:-/tmp/voice-output.mp3}"

ELEVEN_KEY="sk_cedf7d5c9b96cfdc910dd56b5ff329e83be7f87b7a0ad366"
VOICE_ID="iP95p4xoKVk53GoZ742B"  # Chris - charming, down-to-earth

if [ -z "$TEXT" ]; then
  echo "Usage: $0 \"text with [tags]\" [output.mp3]"
  echo ""
  echo "Supported v3 tags:"
  echo "  [sighs], [whispers], [shouts], [sings]"
  echo "  [laughs], [starts laughing], [exhales]"
  echo "  [sarcastic], [curious], [excited], [crying], [mischievously]"
  echo "  [pause], [short pause], [long pause]"
  exit 1
fi

echo "🎙️  Generating voice with ElevenLabs v3..."

curl -s "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID" \
  -H "xi-api-key: $ELEVEN_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"text\": $(echo "$TEXT" | jq -Rs .),
    \"model_id\": \"eleven_v3\",
    \"voice_settings\": {
      \"stability\": 0.0,
      \"similarity_boost\": 0.8,
      \"style\": 0.6
    }
  }" \
  --output "$OUTPUT"

SIZE=$(stat -f%z "$OUTPUT" 2>/dev/null || stat -c%s "$OUTPUT")
if [ "$SIZE" -lt 1000 ]; then
  echo "❌ Error - response too small:"
  cat "$OUTPUT"
  exit 1
fi

echo "✅ Generated: $OUTPUT ($(numfmt --to=iec $SIZE 2>/dev/null || echo "${SIZE}B"))"
