#!/bin/bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
export WRANGLER_SEND_METRICS=false
export WRANGLER_WRITE_LOGS=false
export CI=true
export NODE_ENV=production
exec "${CODEBREAKDOWN_NODE:-/opt/homebrew/bin/node}" \
  "$APP_DIR/node_modules/wrangler/bin/wrangler.js" dev \
  --config "$APP_DIR/dist/server/wrangler.json" \
  --local --ip 0.0.0.0 --port "${CODEBREAKDOWN_PORT:-8788}" \
  --inspector-ip 127.0.0.1 --inspector-port 0 \
  --show-interactive-dev-session false --log-level info
