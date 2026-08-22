#!/usr/bin/env bash
set -euo pipefail
# Self-bootstrapping launcher for the mcp-ssh-manager MCP server.
# Codex does not auto-install deps for local/git plugins, so install runtime
# deps on first run (only when node_modules is absent), then start over stdio.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
if [ ! -d node_modules ]; then
  npm install --omit=dev --no-audit --no-fund
fi
exec node src/index.js
