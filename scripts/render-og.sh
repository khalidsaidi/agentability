#!/usr/bin/env bash
# Renders the social card once into assets/og.png (1200x630). Re-run only when the card changes.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-google-chrome}"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 --virtual-time-budget=4000 \
  --screenshot="$PWD/assets/og.png" "file://$PWD/scripts/og-card.html" 2>/dev/null
echo "assets/og.png: $(identify -format '%wx%h' assets/og.png 2>/dev/null || echo rendered)"
