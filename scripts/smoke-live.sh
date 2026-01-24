#!/usr/bin/env bash
set -euo pipefail

check_header() {
  local url="$1"
  local header="$2"
  local value="$3"
  local headers
  headers="$(curl -sSIL "$url" | tr -d '\r')"
  echo "$headers" | grep -qi "HTTP/2 200"
  echo "$headers" | grep -qi "${header}: ${value}"
}

check_header "https://agentability.org/badge/agentability.org.svg" "content-type" "image/svg+xml"
check_header "https://agentability.org/discovery/audit/latest.pretty.json" "content-type" "application/json"

echo "Live smoke checks passed."
