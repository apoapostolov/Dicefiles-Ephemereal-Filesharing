#!/usr/bin/env bash
set -euo pipefail

# Canonical restart helper for Dicefiles (use inside a persistent PTY such as tmux/screen)
# - Enforces explicit Node 18 binary for build/start (per AGENTS.md)
# - Runs the server in the foreground so the operator can monitor logs
# - For background use, redirect output to ./server.log from the caller (see note below)

NODE_BIN="/home/apoapostolov/.nvm/versions/node/v18.20.8/bin/node"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[dicefiles] verifying shell node (may be different from required Node 18):"
node -v || true
echo "[dicefiles] using explicit Node binary: $NODE_BIN"
$NODE_BIN -v

echo "[dicefiles] building client bundle (production)..."
$NODE_BIN ./node_modules/webpack-cli/bin/cli.js --mode=production

echo "[dicefiles] starting server (foreground). Run this inside a persistent PTY (tmux/screen).
To run in background and persist logs, call this script as:
  setsid sh ./scripts/restart-server.sh > server.log 2>&1 &
(or: sh ./scripts/restart-server.sh > server.log 2>&1 &)
Note: detached background runs are less reliable in this environment; prefer a persistent PTY."

# Exec so the server replaces the script process (clean & visible in PTY)
exec $NODE_BIN server.js
