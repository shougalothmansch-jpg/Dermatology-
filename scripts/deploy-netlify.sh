#!/usr/bin/env bash
# Builds Derm Path and publishes it, with the sync function, to the Netlify site.
# Needs a Netlify token: in a Claude Code cloud session the network proxy supplies it
# (any placeholder value works); elsewhere set NETLIFY_AUTH_TOKEN to a real token.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
NETLIFY_AUTH_TOKEN="${NETLIFY_AUTH_TOKEN:-proxy-injected}" npx --yes netlify-cli@17.38.1 deploy --prod \
  --dir dist --functions netlify/functions --site "${NETLIFY_SITE_NAME:-zippy-malasada-7512e5}" --message "${1:-Update}"
