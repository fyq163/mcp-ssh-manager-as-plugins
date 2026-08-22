# mcp-ssh-manager

A ChatGPT / Codex plugin that:

1. **Bundles the `mcp-ssh-manager` MCP server** (stdio, launched via
   `node /usr/local/lib/node_modules/mcp-ssh-manager/src/index.js`).
2. **Prompts on every conversation turn** to use that MCP server whenever the
   task could touch remote hosts — implemented as a `UserPromptSubmit` lifecycle
   hook (`hooks/hooks.json` → `hooks/prompt_mcp_ssh.py`).
3. Ships a skill (`skills/use-ssh-manager/SKILL.md`) describing when and how to
   call the MCP server's tools.

## Layout

```
.codex-plugin/plugin.json        # required manifest (plugin identity + component pointers)
.mcp.json                        # bundled mcp_servers.mcp-ssh-manager
hooks/hooks.json                 # UserPromptSubmit hook definition
hooks/prompt_mcp_ssh.py          # prints the per-turn reminder
skills/use-ssh-manager/SKILL.md  # skill teaching the agent to use the MCP server
```

## How it works

- `.codex-plugin/plugin.json` points `mcpServers` at `./.mcp.json` and `hooks`
  at `./hooks/hooks.json`.
- On each user message, Codex runs `prompt_mcp_ssh.py`, which prints a reminder
  to prefer `mcp-ssh-manager` tools over a raw shell `ssh`. The hook is
  read-only and always exits 0, so it never blocks the turn.
- The bundled MCP server is enabled/disabled and its tool approval policy can
  be tuned from the Codex config without editing the plugin:

  ```toml
  [plugins."mcp-ssh-manager".mcp_servers."mcp-ssh-manager"]
  enabled = true
  default_tools_approval_mode = "prompt"
  ```

## Local install & test (repo marketplace)

1. Make sure the marketplace file exists at
    `.agents/plugins/marketplace.json` and points at this
   plugin (see that file for the `source.path`).
2. Restart the ChatGPT desktop app (or use Codex CLI).
3. Open the Plugins Directory, pick the local marketplace, install
   **MCP SSH Manager**, and start a new chat.
4. Send any message — you should see the "Reminding to use mcp-ssh-manager"
   status, and the `mcp-ssh-manager` tools become available.

## Notes

- The MCP server path is macOS/Linux absolute
  (`/usr/local/lib/node_modules/...`). Adjust `.mcp.json` if your install
  differs.
- Plugin-bundled hooks are **non-managed**: Codex skips them until you review
  and trust the current hook definition in settings.
