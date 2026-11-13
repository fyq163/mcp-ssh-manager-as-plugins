#!/usr/bin/env bash
# install.sh — one-line install for the mcp-ssh-manager OpenCode plugin.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/fyq163/mcp-ssh-manager-as-plugins/codex-oc-plugins/scripts/install-opencode.sh | bash
#
# Or with a specific version:
#   VERSION=v3.8.6 ./install.sh
#
# This script:
#   1. Creates ~/.config/opencode/plugins/ if it doesn't exist
#   2. Downloads the latest mcp-ssh-manager.js plugin from GitHub
#   3. Records the absolute Node.js executable used during installation
#   4. Verifies the file syntax and prints a summary
#
# No npm install, no package manager, no MCP config block required.
# The plugin auto-spawns the MCP server as a subprocess on first use.

set -euo pipefail

REPO="fyq163/mcp-ssh-manager-as-plugins"
BRANCH="${VERSION:-codex-oc-plugins}"
URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/.opencode/plugins/mcp-ssh-manager.js"
DEST_DIR="${OPENCODE_PLUGIN_DIR:-$HOME/.config/opencode/plugins}"
DEST="${DEST_DIR}/mcp-ssh-manager.js"
CONFIG_DEST="${DEST_DIR}/mcp-ssh-manager.config.json"

# Allow custom install dir via --dest
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)
      DEST="$2"
      DEST_DIR="$(dirname "$DEST")"
      CONFIG_DEST="${DEST_DIR}/mcp-ssh-manager.config.json"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/.opencode/plugins/mcp-ssh-manager.js"
      shift 2
      ;;
    --uninstall)
      echo "Uninstalling $DEST"
      rm -f "$DEST" "$CONFIG_DEST"
      echo "Done. Remove the file manually if you copied it elsewhere."
      exit 0
      ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Capture the exact Node executable visible to the installer. OpenCode may be
# launched later with a different PATH (for example, from a desktop launcher).
NODE_BIN="$(type -P node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Error: Node.js was not found. Install Node.js, then rerun this installer." >&2
  exit 1
fi
NODE_BIN="$(cd "$(dirname "$NODE_BIN")" && pwd -P)/$(basename "$NODE_BIN")"

echo "==> mcp-ssh-manager OpenCode plugin installer"
echo "    Source: $URL"
echo "    Target: $DEST"
echo "    Node:   $NODE_BIN"

# 1. Create destination directory
mkdir -p "$DEST_DIR"

# 2. Back up any existing plugin/config files
BACKUP_SUFFIX="$(date +%s)"
if [[ -f "$DEST" ]]; then
  cp "$DEST" "${DEST}.bak.${BACKUP_SUFFIX}"
  echo "==> Backed up existing plugin to ${DEST}.bak.${BACKUP_SUFFIX}"
fi
if [[ -f "$CONFIG_DEST" ]]; then
  cp "$CONFIG_DEST" "${CONFIG_DEST}.bak.${BACKUP_SUFFIX}"
  echo "==> Backed up existing config to ${CONFIG_DEST}.bak.${BACKUP_SUFFIX}"
fi

# 3. Download
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$DEST"
elif command -v wget >/dev/null 2>&1; then
  wget -q "$URL" -O "$DEST"
else
  echo "Error: need curl or wget" >&2
  exit 1
fi

# 4. Sanity-check the downloaded file with the captured Node executable
if ! "$NODE_BIN" --check "$DEST" 2>/dev/null; then
  echo "Error: downloaded file failed node --check" >&2
  rm -f "$DEST"
  exit 1
fi

# 5. Persist the same executable path for OpenCode's later plugin process.
"$NODE_BIN" - "$CONFIG_DEST" "$NODE_BIN" <<'NODE'
const fs = require("node:fs");
const [configPath, nodePath] = process.argv.slice(2);
fs.writeFileSync(
  configPath,
  `${JSON.stringify({ nodePath }, null, 2)}\n`,
  { mode: 0o600 }
);
fs.chmodSync(configPath, 0o600);
NODE

# 6. Summary
echo ""
echo "==> Installed successfully"
echo "    Plugin: $DEST"
echo "    Node config: $CONFIG_DEST"
echo "    Size:   $(wc -c < "$DEST" | tr -d ' ') bytes"
echo ""
echo "OpenCode auto-discovers ~/.config/opencode/plugins/*.js at startup."
echo "The plugin will use the Node.js path recorded during installation."
echo "Just open any project with 'opencode' and all 37 SSH tools will be available."
echo ""
echo "To uninstall: $0 --uninstall"
