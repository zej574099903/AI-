#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "${ROOT_DIR}/scripts/stop-remote-api.sh"

echo
echo "Press Enter to close this window."
read -r
