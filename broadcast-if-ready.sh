#!/bin/bash
# Only broadcast if v1.2 or higher is active

cd /var/www/snap

VERSION=$(cat api/evolution.json 2>/dev/null | jq -r '.currentVersion // "1.1"')

# Compare versions (simple check for 1.2+)
if [[ "$VERSION" == "1.2" || "$VERSION" == "1.3" || "$VERSION" == "1.4" || "$VERSION" == "2.0" ]]; then
    node broadcaster.js >> /var/log/awol-broadcast.log 2>&1
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Broadcast sent (v$VERSION)"
else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Broadcast skipped (v$VERSION < 1.2)"
fi
