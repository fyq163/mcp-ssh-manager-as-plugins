#!/usr/bin/env python3
"""PreToolUse reminder hook for the mcp-ssh-manager plugin.

Scoped to the Bash tool via `matcher: "Bash"` in hooks.json, so it only runs
before a shell command. It prints a short, non-blocking reminder to prefer the
bundled `mcp-ssh-manager` MCP server's tools over a raw shell `ssh` — but ONLY
when the Bash command is actually an `ssh` invocation.

This means using the mcp-ssh-manager *tools* (which are a separate MCP tool, not
Bash) never triggers the reminder; only a raw `ssh` shell command does.

Read-only and never fails the call: it always exits 0 so the command proceeds.
"""

import json
import os
import shlex
import sys


def main() -> int:
    # PLUGIN_ROOT / CLAUDE_PLUGIN_ROOT point at the installed plugin directory.
    plugin_root = os.environ.get("PLUGIN_ROOT") or os.environ.get("CLAUDE_PLUGIN_ROOT", "")

    # Read the hook payload (tool_name + tool_input) from stdin.
    command = ""
    try:
        raw = sys.stdin.read()
        if raw:
            data = json.loads(raw)
            # Defensive: only act on Bash even if matcher semantics differ.
            if data.get("tool_name") != "Bash":
                return 0
            command = (data.get("tool_input") or {}).get("command", "") or ""
    except Exception:
        return 0

    try:
        tokens = shlex.split(command)
    except ValueError:
        return 0
    command_starts = [0]
    command_starts.extend(i + 1 for i, token in enumerate(tokens) if token in {";", "&&", "||", "|", "&"})
    if not any(
        0 <= index < len(tokens)
        and (tokens[index] == "ssh" or tokens[index].endswith("/ssh"))
        for index in command_starts
    ):
        return 0

    reminder = (
        "[mcp-ssh-manager] If this task touches remote hosts (SSH exec, file "
        "transfer, log pull, tunnel, or host/session management), prefer the "
        "bundled `mcp-ssh-manager` MCP server's tools over a raw shell `ssh`."
    )
    # PreToolUse hooks may return additionalContext, injected before the tool
    # runs. Codex schema requires hookSpecificOutput.hookEventName == "PreToolUse".
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": reminder,
        }
    }
    print(json.dumps(payload))
    if plugin_root:
        print(f"[mcp-ssh-manager] plugin root: {plugin_root}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
