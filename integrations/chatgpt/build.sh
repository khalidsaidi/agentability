#!/usr/bin/env bash
# Builds the ChatGPT plugin ZIP for the OpenAI plugin submission portal.
# Output: integrations/chatgpt/dist/agentability-chatgpt-<version>.zip
set -euo pipefail
cd "$(dirname "$0")"
version=$(python3 -c "import json;print(json.load(open('plugin.json'))['version'])")
rm -rf dist build && mkdir -p dist build/assets
cp plugin.json mcp.json build/
cp -r skills build/
cp ../../assets/icon-512.png build/assets/icon.png
cp ../../assets/icon-512.png build/assets/logo.png
python3 -c "import json;[json.load(open(f)) for f in ['build/plugin.json','build/mcp.json']];print('json ok')"
(cd build && zip -qr "../dist/agentability-chatgpt-${version}.zip" .)
rm -rf build
unzip -l "dist/agentability-chatgpt-${version}.zip"
