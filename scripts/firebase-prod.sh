#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROJECT_ID="${FIREBASE_PROJECT_ID:-agentability-prod-jenfjn}"
EXPECTED_CLIENT_EMAIL="${FIREBASE_EXPECTED_CLIENT_EMAIL:-firebase-deployer@agentability-prod-jenfjn.iam.gserviceaccount.com}"

# `pnpm <script> -- <args>` passes a literal "--" as argv[1].
if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/firebase-prod.sh <firebase-command> [args...]"
  echo "Example: GOOGLE_APPLICATION_CREDENTIALS=/path/prod-sa.json pnpm firebase:prod -- deploy --only hosting"
  exit 2
fi

if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
  echo "ERROR: GOOGLE_APPLICATION_CREDENTIALS is not set." >&2
  echo "Set it to the prod Firebase deployer service account key JSON file." >&2
  exit 2
fi

if [[ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
  echo "ERROR: GOOGLE_APPLICATION_CREDENTIALS points to a missing file: $GOOGLE_APPLICATION_CREDENTIALS" >&2
  exit 2
fi

for arg in "$@"; do
  if [[ "$arg" == "--project" || "$arg" == --project=* ]]; then
    echo "ERROR: Do not pass --project manually; this wrapper enforces --project=$EXPECTED_PROJECT_ID." >&2
    exit 2
  fi
done

identity="$(node -e '
const fs = require("fs");
const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const raw = fs.readFileSync(path, "utf8");
const creds = JSON.parse(raw);
const projectId = creds.project_id || "";
const clientEmail = creds.client_email || "";
process.stdout.write(`${projectId}\t${clientEmail}`);
')"

actual_project_id="${identity%%$'\t'*}"
actual_client_email="${identity#*$'\t'}"

if [[ "$actual_project_id" != "$EXPECTED_PROJECT_ID" ]]; then
  echo "ERROR: Wrong service account project." >&2
  echo "Expected project_id=$EXPECTED_PROJECT_ID but got project_id=$actual_project_id" >&2
  exit 2
fi

if [[ -n "$EXPECTED_CLIENT_EMAIL" && "$actual_client_email" != "$EXPECTED_CLIENT_EMAIL" ]]; then
  echo "ERROR: Wrong service account identity." >&2
  echo "Expected client_email=$EXPECTED_CLIENT_EMAIL but got client_email=$actual_client_email" >&2
  exit 2
fi

echo "Using Firebase deploy identity: $actual_client_email ($actual_project_id)"

exec pnpm dlx firebase-tools "$@" --project "$EXPECTED_PROJECT_ID" --non-interactive
