#!/usr/bin/env bash
# Renders the site icon into assets/ at every size used. Re-run only when the icon changes.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-google-chrome}"
for size in 512 192 180 48 32; do
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --default-background-color=00000000 \
    --window-size=${size},${size} --virtual-time-budget=4000 \
    --screenshot="$PWD/assets/icon-${size}.png" "file://$PWD/scripts/icon-card.html" 2>/dev/null
  echo "assets/icon-${size}.png"
done
