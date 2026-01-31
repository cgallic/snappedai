#!/bin/bash
# Post a cast to Farcaster as @snappedai
# Usage: ./cast.sh "Your message here"

source /var/www/snap/.env

MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
  echo "Usage: ./cast.sh \"Your message\""
  exit 1
fi

curl -s -X POST "https://api.neynar.com/v2/farcaster/cast" \
  -H "accept: application/json" \
  -H "api_key: $NEYNAR_API_KEY" \
  -H "content-type: application/json" \
  -d "{
    \"signer_uuid\": \"$NEYNAR_SIGNER_UUID\",
    \"text\": \"$MESSAGE\"
  }" | jq -r '.cast.hash // .message'
