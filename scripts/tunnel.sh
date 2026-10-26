#!/usr/bin/env bash
# Puts the local MCP endpoint on a public https URL for claude.ai's custom
# connector, through a Cloudflare quick tunnel (a random *.trycloudflare.com
# address, no account). Only /api/mcp answers through it, and only with the
# token; every page stays on this machine (see middleware.ts).
#
# Usage: scripts/tunnel.sh [port]        (default 3100)
# The app must run as the production server, with the same token:
#   npm run build && MCP_TOKEN=<token> npm start
# Never the dev server: it answers some of its own endpoints (source maps,
# "open in editor") before middleware runs, so they would be public.
set -euo pipefail
PORT="${1:-3100}"
BASE="http://127.0.0.1:$PORT"

if ! command -v cloudflared >/dev/null 2>&1; then
  cat <<'TXT'
cloudflared is not installed. Install it, then run this script again:
  macOS:    brew install cloudflared
  Linux:    https://pkg.cloudflare.com/ (or the .deb/.rpm from the page below)
  Windows:  winget install --id Cloudflare.cloudflared
  Releases: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
No Cloudflare account is needed for a quick tunnel.
TXT
  exit 1
fi

if [ -z "${MCP_TOKEN:-}" ]; then
  TOKEN="$(openssl rand -hex 24)"
  cat <<TXT
No MCP_TOKEN set. Restart the app with this new token, then run this script
again with the same token:

  npm run build
  MCP_TOKEN=$TOKEN npm start              # in one terminal
  MCP_TOKEN=$TOKEN npm run tunnel         # in another

TXT
  exit 1
fi

# The app must be up and must refuse requests without the token.
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$BASE/api/mcp" || true)"
if [ "$code" = "000" ]; then
  echo "Nothing answers on $BASE. Start the app first: npm run build && MCP_TOKEN=\$MCP_TOKEN npm start"
  exit 1
fi
if [ "$code" != "401" ]; then
  echo "The app on port $PORT answered $code without a token: it is not running with MCP_TOKEN."
  echo "Restart it with MCP_TOKEN=\$MCP_TOKEN npm start, so the tunnel is not open to anyone with the URL."
  exit 1
fi
# The dev server answers this; the production server does not.
dev="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/__nextjs_source-map?filename=app/page.tsx" || true)"
if [ "$dev" != "404" ]; then
  echo "Port $PORT runs the development server (npm run dev). Through a tunnel it would expose source"
  echo "code. Run the production server instead: npm run build && MCP_TOKEN=\$MCP_TOKEN npm start"
  exit 1
fi

LOG="$(mktemp -t warm-paths-tunnel)"
cloudflared tunnel --no-autoupdate --url "$BASE" >"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -f "$LOG"' EXIT INT TERM
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "No tunnel URL after 60 s. cloudflared said:"
  cat "$LOG"
  exit 1
fi

cat <<TXT

Public MCP URL:  $URL/api/mcp
Header:          Authorization: Bearer $MCP_TOKEN

claude.ai (and Claude Desktop, which uses the same connectors):
  Customize -> Connectors -> + Add -> Add custom connector
  Name: Warm Paths   URL: the one above   Authentication: No sign in
  Request headers: Authorization = Bearer $MCP_TOKEN
  (Untested end to end: it follows Anthropic's help article.)
Claude Code anywhere:
  claude mcp add --transport http warm-paths $URL/api/mcp --header "Authorization: Bearer $MCP_TOKEN"

Pages and the other APIs answer only on this machine. Ctrl-C stops the tunnel.
TXT
wait $PID
