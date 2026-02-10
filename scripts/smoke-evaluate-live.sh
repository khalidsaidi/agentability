#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-https://agentability.org}"

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required binary: $1" >&2
    exit 1
  }
}

require_bin curl
require_bin jq

echo "Checking backend version endpoint..."
info="$(curl -fsS "$API_BASE/v1")"
if ! echo "$info" | jq -e '.version and (.endpoints.evaluate.path == "/v1/evaluate")' >/dev/null; then
  echo "ERROR: $API_BASE/v1 does not expose a backend version yet." >&2
  echo "This usually means the Functions backend is still on an older revision (hosting can update independently)." >&2
  exit 1
fi
rev="$(echo "$info" | jq -r '.revision // empty')"
if [[ -z "$rev" ]]; then
  echo "WARN: $API_BASE/v1 returned version but no revision; consider wiring AGENTABILITY_BUILD/K_REVISION." >&2
fi

eval_domain() {
  local domain="$1"
  local payload
  payload="$(jq -cn --arg origin "https://${domain}" '{origin:$origin}')"  # profile defaults to auto

  local code
  code="$(curl -sS -o /tmp/agentability-eval.json -w "%{http_code}" \
    -X POST "$API_BASE/v1/evaluate" \
    -H "content-type: application/json" \
    --data "$payload")"

  if [[ "$code" != "200" ]]; then
    echo "ERROR: POST /v1/evaluate for ${domain} returned HTTP ${code}" >&2
    cat /tmp/agentability-eval.json >&2
    exit 1
  fi

  jq -e '.runId and .status and .jsonUrl and .reportUrl and .statusUrl and .domain' \
    /tmp/agentability-eval.json >/dev/null

  local status
  status="$(jq -r '.status' /tmp/agentability-eval.json)"
  echo "OK  ${domain} -> status=${status}"
}

echo "Running live evaluations..."
eval_domain "aistatusdashboard.com"
eval_domain "stripe.com"
eval_domain "github.com"
eval_domain "openai.com"
eval_domain "vercel.com"

echo "Live evaluation smoke checks passed."
