# mcp-ssh-manager

A ChatGPT / Codex plugin that:

1. **Bundles the `mcp-ssh-manager` MCP server** (stdio, launched via
   `node <path>/src/index.js` — see [Install](#install) for the real path).
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

## Install

### Where `index.js` lives

| Copy | Path | Use |
|------|------|-----|
| Source (submodule) | `~/sources/agent-plugins/plugins/codex-plugin-ssh-manager/src/index.js` | Stable path; survives plugin upgrades. Point other clients here. |
| Codex plugin cache (what Codex actually runs) | `~/.codex/plugins/cache/fyq-agent-plugins/mcp-ssh-manager/3.8.0/src/index.js` | Regenerated on every (re)install/upgrade. |
| ~~Old global path~~ | `/usr/local/lib/node_modules/mcp-ssh-manager/src/index.js` | **Gone.** Never use this. |

### Codex (via the repo marketplace)

```bash
codex plugin marketplace add /Users/fyq/sources/agent-plugins
codex plugin add mcp-ssh-manager@fyq-agent-plugins
```

Codex does **not** run `npm install` for you. Install deps in the cache dir:

```bash
cd ~/.codex/plugins/cache/fyq-agent-plugins/mcp-ssh-manager/3.8.0
npm install --omit=dev
```

#### Codex 0.149.1 `${PLUGIN_ROOT}` bug

This Codex version does **not** expand `${PLUGIN_ROOT}` in a plugin's
`.mcp.json` args — it joins the literal onto the marketplace dir, producing
`Cannot find module '/Users/fyq/sources/agent-plugins/${PLUGIN_ROOT}/src/index.js'`
→ `connection closed: initialize response`.

Fix: patch the cached `.mcp.json` args to the absolute cache path:

```json
// ~/.codex/plugins/cache/fyq-agent-plugins/mcp-ssh-manager/3.8.0/.mcp.json
{ "mcpServers": { "mcp-ssh-manager": { "command": "node",
    "args": ["/Users/fyq/.codex/plugins/cache/fyq-agent-plugins/mcp-ssh-manager/3.8.0/src/index.js"] } } }
```

> **Redo this after every plugin (re)install/upgrade** — the cache is wiped and
> re-cloned, so the patch is lost. The submodule source keeps `${PLUGIN_ROOT}`
> (correct syntax; newer Codex expands it).

Verify: `codex mcp list` should show `mcp-ssh-manager` with the expanded
absolute path and `Status: enabled`.

### opencode / grok / codebuddy

Point these at the **submodule** source (stable path) after installing deps
there once:

```bash
cd ~/sources/agent-plugins/plugins/codex-plugin-ssh-manager
npm install --omit=dev
```

- **opencode** — `~/.config/opencode/opencode.json`:
  ```json
  "mcp": { "ssh-manager": { "type": "local", "enabled": true,
    "command": ["node", "/Users/fyq/sources/agent-plugins/plugins/codex-plugin-ssh-manager/src/index.js"] } }
  ```
- **grok** — `~/.grok/config.toml`:
  ```toml
  [mcp_servers.ssh-manager]
  command = "node"
  args = ["/Users/fyq/sources/agent-plugins/plugins/codex-plugin-ssh-manager/src/index.js"]
  ```
- **codebuddy** — `~/.codebuddy/mcp.json`:
  ```json
  "mcp-ssh-manager": { "type": "stdio", "command": "node",
    "args": ["/Users/fyq/sources/agent-plugins/plugins/codex-plugin-ssh-manager/src/index.js"] }
  ```

Restart the client after editing its config.

## Notes

- Plugin-bundled hooks are **non-managed**: Codex skips them until you review
  and trust the current hook definition in settings.
