---
name: ssh-on
description: Enter SSH-only mode — restrict all remote operations to the bundled mcp-ssh-manager MCP tools. Use when user runs /ssh-on, wants MCP-only, or says "limit to MCP/ssh on".
---

# SSH-only mode (MCP tools only)

From now until the session ends (or the user runs `/ssh-off`), ALL remote-host
work MUST go through the bundled **mcp-ssh-manager** MCP server.

## Rules
- Only use MCP tool calls scoped to this server:
  `mcp__mcp-ssh-manager__*` (or `mcp__plugin_mcp-ssh-manager_mcp-ssh-manager__*`
  when namespaced by plugin).
- FORBIDDEN for remote tasks: raw shell `ssh`, `scp`, `rsync`. Redirect to the
  MCP equivalents instead (`ssh_execute`, `ssh_upload`, `ssh_download`,
  `ssh_sync`, ...).
- Still confirm the target host with the user before any destructive command.
- If unsure of exact tool names, list the server's tools first.

## Available tools (37)
- Exec: `ssh_execute`, `ssh_execute_sudo`
- Transfer: `ssh_upload`, `ssh_download`, `ssh_deploy`, `ssh_sync`
- Tunnels/sessions: `ssh_tunnel_*`, `ssh_session_*`
- Hosts/groups/aliases: `ssh_list_servers`, `ssh_alias`, `ssh_group_*`,
  `ssh_command_alias`, `ssh_profile`, `ssh_hooks`
- Backup: `ssh_backup_create|list|restore|schedule`
- Database: `ssh_db_dump|import|list|query`
- Health/monitoring: `ssh_health_check`, `ssh_service_status`,
  `ssh_process_manager`, `ssh_alert_setup`, `ssh_monitor`, `ssh_tail`

Exit this mode only when the user says `/ssh-off`.
