// OpenCode plugin entry for mcp-ssh-manager.
//
// The MCP server itself is registered via the sibling `opencode.json`
// (under `mcp.mcp-ssh-manager`). This file exists so the submodule is
// picked up as a plugin directory when the plugin files are copied into
// `~/.config/opencode/plugins/` or another plugin path on the OpenCode
// load path. It is intentionally a no-op plugin: v1 simply ships the MCP
// server. Hook behaviour (e.g. nudging the model to use an existing tool
// instead of raw `ssh` on the Bash tool) can be layered in here later.
export const MCPSSHManagerPlugin = async () => {
  return {};
};
