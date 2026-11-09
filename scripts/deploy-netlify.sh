#!/usr/bin/env bash
# Builds Derm Path and publishes it to the Netlify site.
# The Netlify token is never stored here: in a Claude Code cloud session it is
# injected by the session's network proxy; elsewhere set NETLIFY_AUTH_TOKEN.
set -euo pipefail
SITE_ID="${NETLIFY_SITE_ID:-55f4394f-3c23-4e89-b09e-2328a0580251}" # zippy-malasada-7512e5.netlify.app
cd "$(dirname "$0")/.."
npm run build
ZIP="$(mktemp -d)/deploy.zip"
(cd dist && zip -qr "$ZIP" .)
AUTH=()
[ -n "${NETLIFY_AUTH_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $NETLIFY_AUTH_TOKEN")
DEPLOY_ID=$(curl -sS -X POST "${AUTH[@]}" -H "Content-Type: application/zip" --data-binary "@$ZIP" \
  "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
for _ in $(seq 1 40); do
  STATE=$(curl -sS "${AUTH[@]}" "https://api.netlify.com/api/v1/deploys/$DEPLOY_ID" | python3 -c 'import sys,json; print(json.load(sys.stdin)["state"])')
  [ "$STATE" = ready ] && { echo "Live: deploy $DEPLOY_ID"; exit 0; }
  [ "$STATE" = error ] && { echo "Deploy $DEPLOY_ID failed" >&2; exit 1; }
  sleep 3
done
echo "Deploy $DEPLOY_ID still processing" >&2
