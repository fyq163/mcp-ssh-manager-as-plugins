#!/usr/bin/env node
// SSH Manager MCP reminder hook (Codex plugin).
//
// Behaviour:
//   - UserPromptSubmit: handles the /ssh-on [target] and /ssh-off commands.
//     They toggle ssh-mode by writing/removing the state file
//     ~/.codex/.ssh-manager-mode, then block the prompt with a confirmation
//     reason so the literal command is never sent to the model.
//   - SessionStart / PostCompact / SubagentStart: when ssh-mode is on (state
//     file exists), inject an additionalContext reminder that tells the model
//     to prefer the SSH Manager MCP tools, including the active target.
//
// Failure policy: never block or hang anything the hook does not own. Any
// error exits 0 silently, matching "mode off = plugin disabled".

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// State file: exists = ssh-mode ON, content = active target (e.g. "bat:/path").
const MODE_FILE =
  process.env.SSH_MODE_FILE || path.join(os.homedir(), ".codex", ".ssh-manager-mode");

const REMINDER_EVENTS = new Set(["SessionStart", "PostCompact", "SubagentStart"]);

// Build the developer-context reminder injected when ssh-mode is on.
function buildReminder(target) {
  const head = target
    ? `SSH mode is ON — current target: ${target}.`
    : "SSH mode is ON.";
  return (
    `${head}\n` +
    "The SSH Manager MCP server is available. For any remote-server work " +
    "(SSH, deploy, remote commands, file transfer, databases, backups, health checks), " +
    "prefer its tools over ad-hoc shell — e.g. ssh_list_servers, ssh_execute, " +
    "ssh_upload, ssh_download, ssh_db_query, ssh_backup, ssh_health_check. " +
    (target
      ? `Target "${target}" may be an alias defined in ssh-manager; resolve it with ` +
        "ssh_list_servers if unsure. "
      : "If unsure which server to target, list configured servers first. ")
  );
}

// Read the full stdin JSON blob Codex sends to every command hook.
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// Block the current user prompt, surfacing `reason` as the confirmation.
function blockPrompt(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
}

// Inject additionalContext for a reminder event.
function injectReminder(eventName, text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
    }) + "\n",
  );
}

async function main() {
  const input = await readStdin();
  const event = input.hook_event_name || "";
  const prompt = (input.prompt || "").trim();

  // ---- Toggle commands (UserPromptSubmit) -----------------------------
  if (event === "UserPromptSubmit") {
    if (prompt.startsWith("/ssh-on")) {
      const target = prompt.slice("/ssh-on".length).trim();
      fs.mkdirSync(path.dirname(MODE_FILE), { recursive: true });
      fs.writeFileSync(MODE_FILE, target);
      blockPrompt(target ? `SSH mode ON → ${target}` : "SSH mode ON");
      return;
    }
    if (prompt.startsWith("/ssh-off")) {
      fs.rmSync(MODE_FILE, { force: true });
      blockPrompt("SSH mode OFF");
      return;
    }
    // Not an ssh-mode command: stay silent.
    process.exit(0);
  }

  // ---- Reminder events (SessionStart / PostCompact / SubagentStart) ----
  if (!REMINDER_EVENTS.has(event)) process.exit(0);
  // Mode off = plugin disabled: no output at all.
  if (!fs.existsSync(MODE_FILE)) process.exit(0);

  const target = fs.readFileSync(MODE_FILE, "utf8").trim();
  injectReminder(event, buildReminder(target || ""));
}

main().catch(() => process.exit(0));
