import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSSHNudgeHook, findGlobalMcpEntry, isRawSshCommand, MCPSSHManagerPlugin } from "../.opencode/plugins/mcp-ssh-manager/server.js";
import TuiPlugin from "../.opencode/plugins/mcp-ssh-manager/tui.js";
import { MCPSSHManagerRpc } from "../.opencode/plugins/mcp-ssh-manager/rpc.js";

test("server and TUI parts expose OpenCode V2 plugin definitions", () => {
  assert.equal(MCPSSHManagerPlugin.id, "mcp-ssh-manager");
  assert.equal(typeof MCPSSHManagerPlugin.setup, "function");
  assert.equal(TuiPlugin.id, "mcp-ssh-manager.tui");
  assert.equal(typeof TuiPlugin.setup, "function");
});

test("SSH reminder matches only raw ssh commands", () => {
  assert.equal(isRawSshCommand("ssh user@example.com"), true);
  assert.equal(isRawSshCommand("  ssh -p 2222 user@example.com"), true);
  assert.equal(isRawSshCommand("ssh-manager list"), false);
  assert.equal(isRawSshCommand("echo ssh user@example.com"), false);
  assert.equal(isRawSshCommand(undefined), false);
});

test("V2 tool hook emits the reminder only for Bash SSH commands", async () => {
  const emitted = [];
  const hook = createSSHNudgeHook({
    events: {
      emit: async (...args) => emitted.push(args),
    },
  });

  await hook({
    tool: "bash",
    input: { command: "ssh user@example.com" },
    sessionID: "session-1",
  });
  await hook({
    tool: "read",
    input: { filePath: "ssh user@example.com" },
    sessionID: "session-2",
  });
  await hook({
    tool: "bash",
    input: { command: "echo ssh user@example.com" },
    sessionID: "session-3",
  });

  assert.deepEqual(emitted, [
    [
      "sshNudge",
      {
        message: "Tip: use ssh_execute from mcp-ssh-manager instead of raw ssh",
        sessionID: "session-1",
      },
    ],
  ]);
});

test("TUI RPC event displays a toast and filters other locations", () => {
  const toasts = [];
  let onSSHNudge;
  let unsubscribed = false;
  const context = {
    location: { directory: "/workspace/current" },
    client: {
      rpc(definition) {
        assert.equal(definition, MCPSSHManagerRpc);
        return {
          events: {
            on(name, callback) {
              assert.equal(name, "sshNudge");
              onSSHNudge = callback;
              return () => {
                unsubscribed = true;
              };
            },
          },
        };
      },
    },
    ui: {
      toast: {
        show: (toast) => toasts.push(toast),
      },
    },
  };

  const cleanup = TuiPlugin.setup(context);
  onSSHNudge({
    location: { directory: "/workspace/other" },
    data: { message: "ignored" },
  });
  onSSHNudge({
    location: { directory: "/workspace/current" },
    data: { message: "Use ssh_execute" },
  });

  assert.deepEqual(toasts, [
    {
      title: "MCP SSH Manager",
      message: "Use ssh_execute",
      variant: "info",
      duration: 5000,
    },
  ]);

  cleanup();
  assert.equal(unsubscribed, true);
});

test("RPC contract describes the SSH reminder event", () => {
  assert.equal(MCPSSHManagerRpc.id, "mcp-ssh-manager");
  assert.deepEqual(MCPSSHManagerRpc.methods, {});
  assert.deepEqual(MCPSSHManagerRpc.events.sshNudge.schema.required, [
    "message",
    "sessionID",
  ]);
});

test("global MCP entry resolves a PATH symlink even without exec bit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ssh-manager-bin-"));
  const entry = path.join(dir, "server.js");
  fs.writeFileSync(entry, "// test entry\n", { mode: 0o644 });
  fs.symlinkSync(entry, path.join(dir, "mcp-ssh-manager"));

  try {
    assert.equal(
      findGlobalMcpEntry(`${dir}${path.delimiter}/nowhere`),
      fs.realpathSync(entry),
    );
    assert.equal(findGlobalMcpEntry("/nowhere"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
