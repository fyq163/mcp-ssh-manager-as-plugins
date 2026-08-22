#!/usr/bin/env python3
"""Per-turn reminder hook for the mcp-ssh-manager plugin.

Runs on every `UserPromptSubmit` event (i.e. each conversation turn where the
user sends a message). It prints a short, non-blocking reminder telling the
agent to consider using the bundled `mcp-ssh-manager` MCP server whenever the
task could involve remote hosts.

This hook is intentionally read-only and never fails the turn: it always exits
0 so the user's prompt proceeds normally.
"""

import os
import sys


def main() -> int:
    # PLUGIN_ROOT / CLAUDE_PLUGIN_ROOT point at the installed plugin directory.
    plugin_root = os.environ.get("PLUGIN_ROOT") or os.environ.get("CLAUDE_PLUGIN_ROOT", "")
    reminder = (
        "[mcp-ssh-manager] If this task touches remote hosts (SSH exec, file "
        "transfer, log pull, tunnel, or host/session management), prefer the "
        "bundled `mcp-ssh-manager` MCP server's tools over a raw shell `ssh`."
    )
    # Printed to stdout; Codex/Claude surfaces it in the turn context / logs.
    print(reminder)
    if plugin_root:
        print(f"[mcp-ssh-manager] plugin root: {plugin_root}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
