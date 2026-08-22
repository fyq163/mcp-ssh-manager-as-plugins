---
name: use-ssh-manager
description: Use the bundled mcp-ssh-manager MCP server for any remote-host work (SSH exec, SCP/transfer, log pull, tunnels, session/host management).
---

# Use mcp-ssh-manager for remote-host work

This plugin bundles the **mcp-ssh-manager** MCP server. Prefer its tools over a
raw shell `ssh`/`scp` whenever a task involves remote hosts.

## When to use it
- Running commands on a remote machine.
- Transferring files to/from a remote host.
- Pulling logs or inspecting remote state.
- Opening tunnels / port forwards.
- Listing, creating, or switching SSH sessions and managed hosts.

## How to invoke
The server is registered as `mcp-ssh-manager` (stdio, launched via
`node /usr/local/lib/node_modules/mcp-ssh-manager/src/index.js`). Once the
plugin is enabled, call its tools directly (e.g. `mcp__mcp-ssh-manager__*`).
Inspect the server's tool list first if you are unsure of exact names.

## Guidance
- Confirm the target host/identity with the user before destructive commands.
- Prefer the MCP tools so operations stay auditable and connection state is
  managed by the server rather than ad-hoc shell invocations.
