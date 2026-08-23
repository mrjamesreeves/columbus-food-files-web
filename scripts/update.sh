#!/usr/bin/env bash
# Paste one restaurant from the clipboard, rebuild, and show what changed.
#   ./scripts/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
pbpaste | node scripts/upsert.js
node scripts/parse.js
node scripts/build.js
echo
echo "Review with: git diff --stat"
echo "Ship with:   git add -A && git commit -m 'Update notes' && git push"
