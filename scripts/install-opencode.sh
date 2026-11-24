#!/usr/bin/env bash
# One-line installer for the dependency-free OpenCode V2 plugin package.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/fyq163/mcp-ssh-manager-as-plugins/codex-oc-plugins/scripts/install-opencode.sh | bash
#
# The script installs the server and TUI parts together. OpenCode provides the
# V2 plugin runtime; the plugin starts the MCP server with the captured Node
# executable, so no npm install or separate MCP configuration is needed.

set -euo pipefail

REPO="fyq163/mcp-ssh-manager-as-plugins"
REF="${VERSION:-codex-oc-plugins}"
PLUGIN_PARENT="${OPENCODE_PLUGIN_DIR:-$HOME/.config/opencode/plugins}"
PLUGIN_DIR="${PLUGIN_PARENT}/mcp-ssh-manager"
LEGACY_PLUGIN="${PLUGIN_PARENT}/mcp-ssh-manager.js"
LEGACY_CONFIG="${PLUGIN_PARENT}/mcp-ssh-manager.config.json"
SOURCE_DIR=""
MODE="install"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)
      if [[ $# -lt 2 ]]; then
        echo "Error: --dest requires a plugin directory" >&2
        exit 2
      fi
      if [[ "$2" == *.js ]]; then
        # Preserve the old --dest file form by converting it to a package dir.
        PLUGIN_DIR="${2%.js}"
      else
        PLUGIN_DIR="$2"
      fi
      PLUGIN_PARENT="$(dirname "$PLUGIN_DIR")"
      LEGACY_PLUGIN="${PLUGIN_PARENT}/mcp-ssh-manager.js"
      LEGACY_CONFIG="${PLUGIN_PARENT}/mcp-ssh-manager.config.json"
      shift 2
      ;;
    --branch)
      if [[ $# -lt 2 ]]; then
        echo "Error: --branch requires a branch name" >&2
        exit 2
      fi
      REF="$2"
      shift 2
      ;;
    --source-dir)
      if [[ $# -lt 2 ]]; then
        echo "Error: --source-dir requires the local V2 plugin package directory" >&2
        exit 2
      fi
      SOURCE_DIR="$2"
      shift 2
      ;;
    --uninstall)
      MODE="uninstall"
      shift
      ;;
    -h|--help)
      sed -n '2,20p' "$0"
      echo "Options: --branch REF, --dest DIR, --source-dir DIR, --uninstall"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$PLUGIN_DIR" != /* ]]; then
  PLUGIN_DIR="$(pwd -P)/$PLUGIN_DIR"
  PLUGIN_PARENT="$(dirname "$PLUGIN_DIR")"
  LEGACY_PLUGIN="${PLUGIN_PARENT}/mcp-ssh-manager.js"
  LEGACY_CONFIG="${PLUGIN_PARENT}/mcp-ssh-manager.config.json"
fi

BACKUP_DIR="$(dirname "$PLUGIN_PARENT")/plugin-backups"
BACKUP_SUFFIX="$(date +%Y%m%d%H%M%S)-$$"

backup_path() {
  local path="$1"
  if [[ -e "$path" ]]; then
    mkdir -p "$BACKUP_DIR"
    local backup="${BACKUP_DIR}/$(basename "$path").${BACKUP_SUFFIX}"
    mv "$path" "$backup"
    echo "==> Backed up $path to $backup"
  fi
}

if [[ "$MODE" == "uninstall" ]]; then
  backup_path "$PLUGIN_DIR"
  backup_path "$LEGACY_PLUGIN"
  backup_path "$LEGACY_CONFIG"
  echo "==> Plugin disabled; backups are outside OpenCode's plugin directory."
  exit 0
fi

NODE_BIN="$(type -P node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Error: Node.js was not found. Install Node.js, then rerun this installer." >&2
  exit 1
fi
NODE_BIN="$(cd "$(dirname "$NODE_BIN")" && pwd -P)/$(basename "$NODE_BIN")"

mkdir -p "$PLUGIN_PARENT"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mcp-ssh-manager.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
STAGE="${TMP_DIR}/package"
mkdir -p "$STAGE"

FILES=(package.json server.js tui.js rpc.js)
BASE_URL="https://raw.githubusercontent.com/${REPO}/${REF}/.opencode/plugins/mcp-ssh-manager"

if [[ -n "$SOURCE_DIR" ]]; then
  SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd -P)"
  echo "==> Installing local OpenCode V2 plugin source"
  echo "    Source: $SOURCE_DIR"
else
  echo "==> Installing mcp-ssh-manager OpenCode V2 plugin"
  echo "    Source: https://github.com/${REPO} (${REF})"
fi
echo "    Target: $PLUGIN_DIR"
echo "    Node:   $NODE_BIN"

for file in "${FILES[@]}"; do
  if [[ -n "$SOURCE_DIR" ]]; then
    if [[ ! -f "${SOURCE_DIR}/${file}" ]]; then
      echo "Error: local plugin source is missing ${file}" >&2
      exit 1
    fi
    cp "${SOURCE_DIR}/${file}" "${STAGE}/${file}"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "${BASE_URL}/${file}" -o "${STAGE}/${file}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "${BASE_URL}/${file}" -O "${STAGE}/${file}"
  else
    echo "Error: need curl or wget" >&2
    exit 1
  fi
done

CONFIG_SOURCE=""
if [[ -f "$LEGACY_CONFIG" ]]; then
  CONFIG_SOURCE="$LEGACY_CONFIG"
elif [[ -f "${PLUGIN_DIR}/mcp-ssh-manager.config.json" ]]; then
  CONFIG_SOURCE="${PLUGIN_DIR}/mcp-ssh-manager.config.json"
fi

"$NODE_BIN" - "$CONFIG_SOURCE" "${STAGE}/mcp-ssh-manager.config.json" "$NODE_BIN" <<'NODE'
const fs = require("node:fs");
const [source, destination, nodePath] = process.argv.slice(2);
let config = {};

if (source && fs.existsSync(source)) {
  config = JSON.parse(fs.readFileSync(source, "utf8"));
}

config.nodePath = nodePath;
fs.writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`, {
  mode: 0o600,
});
fs.chmodSync(destination, 0o600);
NODE

"$NODE_BIN" - "$STAGE" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

if (
  manifest.type !== "module" ||
  manifest.exports?.["."] !== "./server.js" ||
  manifest.exports?.["./tui"] !== "./tui.js" ||
  manifest.exports?.["./rpc"] !== "./rpc.js"
) {
  throw new Error("OpenCode V2 plugin package manifest is invalid");
}
NODE

"$NODE_BIN" --check "${STAGE}/server.js"
"$NODE_BIN" --check "${STAGE}/tui.js"
"$NODE_BIN" --check "${STAGE}/rpc.js"
"$NODE_BIN" --input-type=module - "$STAGE" <<'NODE'
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const server = await import(pathToFileURL(path.join(root, "server.js")).href);
const tui = await import(pathToFileURL(path.join(root, "tui.js")).href);
await import(pathToFileURL(path.join(root, "rpc.js")).href);

if (server.default?.id !== "mcp-ssh-manager" || typeof server.default.setup !== "function") {
  throw new Error("OpenCode V2 server plugin entrypoint is invalid");
}
if (tui.default?.id !== "mcp-ssh-manager.tui" || typeof tui.default.setup !== "function") {
  throw new Error("OpenCode V2 TUI plugin entrypoint is invalid");
}
NODE

OLD_PACKAGE_BACKUP=""
OLD_PLUGIN_BACKUP=""
OLD_CONFIG_BACKUP=""

if [[ -e "$PLUGIN_DIR" ]]; then
  mkdir -p "$BACKUP_DIR"
  OLD_PACKAGE_BACKUP="${BACKUP_DIR}/mcp-ssh-manager.${BACKUP_SUFFIX}"
  mv "$PLUGIN_DIR" "$OLD_PACKAGE_BACKUP"
  echo "==> Backed up existing package to $OLD_PACKAGE_BACKUP"
fi

if [[ -e "$LEGACY_PLUGIN" ]]; then
  mkdir -p "$BACKUP_DIR"
  OLD_PLUGIN_BACKUP="${BACKUP_DIR}/mcp-ssh-manager.js.${BACKUP_SUFFIX}"
  mv "$LEGACY_PLUGIN" "$OLD_PLUGIN_BACKUP"
  echo "==> Backed up and disabled legacy V1 plugin: $OLD_PLUGIN_BACKUP"
fi

if [[ -e "$LEGACY_CONFIG" ]]; then
  mkdir -p "$BACKUP_DIR"
  OLD_CONFIG_BACKUP="${BACKUP_DIR}/mcp-ssh-manager.config.json.${BACKUP_SUFFIX}"
  mv "$LEGACY_CONFIG" "$OLD_CONFIG_BACKUP"
fi

if ! mv "$STAGE" "$PLUGIN_DIR"; then
  echo "Error: could not activate the downloaded plugin; restoring the previous install." >&2
  [[ -n "$OLD_PACKAGE_BACKUP" ]] && mv "$OLD_PACKAGE_BACKUP" "$PLUGIN_DIR"
  [[ -n "$OLD_PLUGIN_BACKUP" ]] && mv "$OLD_PLUGIN_BACKUP" "$LEGACY_PLUGIN"
  [[ -n "$OLD_CONFIG_BACKUP" ]] && mv "$OLD_CONFIG_BACKUP" "$LEGACY_CONFIG"
  exit 1
fi

echo ""
echo "==> Installed and verified"
echo "    Package: $PLUGIN_DIR"
echo "    OpenCode V2 server + TUI hook: ready"
echo "    Node config: $PLUGIN_DIR/mcp-ssh-manager.config.json"
echo ""
echo "OpenCode will reload the global plugin package automatically."
echo "The SSH reminder appears as a TUI toast when Bash runs a raw ssh command."
echo "To disable it without deleting files, run this installer with --uninstall."
