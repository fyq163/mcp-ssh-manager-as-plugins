#!/usr/bin/env bash
# install.sh — one-line install for the mcp-ssh-manager OpenCode plugin.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/fyq163/mcp-ssh-manager-as-plugins/feat/ssh-manager-codex-plugin/scripts/install-opencode.sh | bash
#
# Or with a specific version:
#   VERSION=v3.8.6 ./install.sh
#
# This script:
#   1. Creates ~/.config/opencode/plugins/ if it doesn't exist
#   2. Downloads the latest mcp-ssh-manager.js plugin from GitHub
#   3. Verifies the file syntax
#   4. Prints a summary
#
# No npm install, no package manager, no MCP config block required.
# The plugin auto-spawns the MCP server as a subprocess on first use.

set -euo pipefail

REPO="fyq163/mcp-ssh-manager-as-plugins"
BRANCH="${VERSION:-feat/ssh-manager-codex-plugin}"
URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/.opencode/plugins/mcp-ssh-manager.js"
DEST_DIR="${OPENCODE_PLUGIN_DIR:-$HOME/.config/opencode/plugins}"
DEST="${DEST_DIR}/mcp-ssh-manager.js"

# Allow custom install dir via --dest
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)
      DEST="$2"
      DEST_DIR="$(dirname "$DEST")"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/.opencode/plugins/mcp-ssh-manager.js"
      shift 2
      ;;
    --uninstall)
      echo "Uninstalling $DEST"
      rm -f "$DEST"
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

echo "==> mcp-ssh-manager OpenCode plugin installer"
echo "    Source: $URL"
echo "    Target: $DEST"

# 1. Create destination directory
mkdir -p "$DEST_DIR"

# 2. Back up any existing copy
if [[ -f "$DEST" ]]; then
  cp "$DEST" "${DEST}.bak.$(date +%s)"
  echo "==> Backed up existing plugin to ${DEST}.bak.$(date +%s)"
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

# 4. Sanity-check the downloaded file
if ! command -v node >/dev/null 2>&1; then
  echo "Warning: node not found, skipping syntax check"
else
  if ! node --check "$DEST" 2>/dev/null; then
    echo "Error: downloaded file failed node --check" >&2
    rm -f "$DEST"
    exit 1
  fi
fi

# 5. Summary
echo ""
echo "==> Installed successfully"
echo "    Plugin: $DEST"
echo "    Size:   $(wc -c < "$DEST" | tr -d ' ') bytes"
echo ""
echo "OpenCode auto-discovers ~/.config/opencode/plugins/*.js at startup."
echo "Just open any project with 'opencode' and all 37 SSH tools will be available."
echo ""
echo "To uninstall: $0 --uninstall"
