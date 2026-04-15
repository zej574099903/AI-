#!/usr/bin/env bash

set -euo pipefail

PORT="${1:-8787}"
TARGET_URL="http://127.0.0.1:${PORT}"

echo "Starting cloudflared tunnel for ${TARGET_URL}"
echo "Keep this terminal open while you need remote access."

exec cloudflared tunnel --url "${TARGET_URL}" --no-autoupdate
