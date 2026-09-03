// OpenCode plugin entry for mcp-ssh-manager.
//
// This file is the OpenCode *plugin* entrypoint, resolved via package.json
// `exports["./server"]` (or `exports["."]`). It spawns the mcp-ssh-manager
// MCP server as a subprocess and bridges its 37 tools into OpenCode's
// native plugin tool interface — so a single `plugin: ["mcp-ssh-manager"]`
// entry in opencode.jsonc is sufficient. No separate `mcp` config block
// required.
//
// Architecture:
//   1. spawn npx -y mcp-ssh-manager  (or node src/index.js from package root)
//   2. JSON-RPC 2.0 initialise handshake over stdio
//   3. tools/list → discover all 37 tools + their JSON-Schema descriptors
//   4. Each MCP tool is mapped to an OpenCode plugin tool() definition using
//      Zod (the package's own copy, version-matched to the runtime). The
//      `tool()` helper is just a pass-through identity function; we don't
//      import `@opencode-ai/plugin/tool` because that package is not
//      available when this plugin is loaded from a npm/git install
//      (Bun only installs runtime deps, not the OpenCode SDK).
//   5. tool.execute() proxies a tools/call request to the subprocess.
//
// Future improvements:
//   - Reconnect automatically if the subprocess dies mid-session.
//   - Support MCP resource templates and prompts if the server adds them.
//   - Add cancellation via notifications/cancelled.

import { z } from "zod";
import { spawn } from "node:child_process";
import os from "node:os";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const tool = (def) => def;

// ─── JSON-Schema → Zod converter ───────────────────────────────────

/**
 * Convert an MCP JSON-Schema property into a Zod type using OpenCode's own
 * Zod instance (tool.schema) so that instanceof checks pass at validation time.
 */
function jsToZod(node) {
  if (!node) return z.any();

  let result;
  switch (node.type) {
    case "string":
      result = node.enum ? z.enum(node.enum) : z.string();
      break;
    case "number":
    case "integer":
      result = z.number();
      break;
    case "boolean":
      result = z.boolean();
      break;
    case "array":
      result = z.array(jsToZod(node.items || {}));
      break;
    case "object":
      result = z.object(_buildShape(node));
      break;
    case "null":
      result = z.null();
      break;
    default:
      result = z.any();
  }

  if (node.description && typeof result.describe === "function") {
    try {
      result = result.describe(node.description);
    } catch {
      /* Zod build without .describe — skip silently */
    }
  }
  return result;
}

function _buildShape(schema) {
  const shape = {};
  const required = schema.required || [];
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    let zod = jsToZod(prop);
    if (!required.includes(key)) {
      zod = zod.optional();
    }
    shape[key] = zod;
  }
  return shape;
}

// ─── MCP JSON-RPC bridge ──────────────────────────────────────────

function findMcpServerEntry() {
  // When loaded from an npm/git-installed package, resolve src/index.js
  // by walking up from this file's location.
  try {
    const here = fileURLToPath(import.meta.url);
    const candidate = resolve(dirname(here), "../../src/index.js");
    if (existsSync(candidate)) return candidate;
  } catch {
    /* ignore */
  }
  return null;
}

class MCPBridge {
  constructor() {
    this.child = null;
    this.buffer = "";
    this.pending = new Map();
    this.msgId = 0;
    this.tools = null;
    this.ready = false;
  }

  getEnv() {
    const env = { ...process.env };
    if (!env.SSH_CONFIG_PATH) {
      const tomlPath = join(
        os.homedir(),
        ".config/mcp-ssh-manager/ssh-config.toml"
      );
      env.SSH_CONFIG_PATH = tomlPath;
    }
    return env;
  }

  getSpawnCommand() {
    const entry = findMcpServerEntry();
    if (entry) return { command: "node", args: [entry] };
    return { command: "npx", args: ["-y", "mcp-ssh-manager"] };
  }

  start() {
    const { command, args } = this.getSpawnCommand();
    const env = this.getEnv();

    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      cwd: os.homedir(),
    });

    this.child.stdout.on("data", (data) => {
      this.buffer += data.toString();
      this._dispatch();
    });

    this.child.stderr.on("data", (data) => {
      process.stderr.write(`[mcp-ssh-manager] ${data}`);
    });

    this.child.on("error", (err) => {
      process.stderr.write(
        `[mcp-ssh-manager] spawn error: ${err.message}\n`
      );
      this.child = null;
      this.ready = false;
    });

    this.child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        process.stderr.write(`[mcp-ssh-manager] exited (${code})\n`);
      }
      this.child = null;
      this.ready = false;
      this.tools = null;
      for (const { reject } of this.pending.values()) {
        reject(new Error("MCP server process exited"));
      }
      this.pending.clear();
    });

    return this._init();
  }

  async _init() {
    // MCP initialise handshake
    await this._request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "opencode", version: "1.0" },
    });

    this._sendNotification("notifications/initialized");

    const resp = await this._request("tools/list", {});
    this.tools = resp.tools || [];
    this.ready = true;
    process.stderr.write(
      `[mcp-ssh-manager] ${this.tools.length} tools discovered\n`
    );
    return this.tools;
  }

  _sendNotification(method, params = {}) {
    this._write({ jsonrpc: "2.0", method, params });
  }

  _write(msg) {
    if (!this.child?.stdin?.writable) {
      throw new Error("MCP server not running");
    }
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  _request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      try {
        this._write({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request ${method} timed out`));
        }
      }, 30000);
    });
  }

  _dispatch() {
    let nl;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(msg.error.message || "MCP error"));
        } else {
          entry.resolve(msg.result);
        }
        continue;
      }

      if (msg.method && typeof msg.method === "string") {
        if (msg.method === "notifications/message") {
          const p = msg.params || {};
          process.stderr.write(
            `[mcp] ${p.level || "info"}: ${p.data || ""}\n`
          );
        }
      }
    }
  }

  async ensureReady() {
    if (this.ready) return;
    if (!this.child) {
      // Restart the subprocess.
      this.buffer = "";
      await this.start();
    } else {
      // Already starting — wait for ready flag.
      await new Promise((resolve) => {
        const check = () =>
          this.ready ? resolve() : setTimeout(check, 100);
        check();
      });
    }
  }

  async callTool(name, args) {
    await this.ensureReady();
    const resp = await this._request("tools/call", {
      name,
      arguments: args,
    });

    if (resp.isError) {
      const first = (resp.content || [])[0];
      throw new Error((first && first.text) || "Tool returned an error");
    }

    const textParts = (resp.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text);

    if (textParts.length === 0) {
      return JSON.stringify(resp.content || {});
    }
    return textParts.join("\n");
  }

  stop() {
    this.child?.kill();
    this.child = null;
    this.ready = false;
    this.tools = null;
  }
}

let bridge = null;

export const MCPSSHManagerPlugin = async (ctx) => {
  if (!bridge) {
    bridge = new MCPBridge();
  }

  try {
    await bridge.start();
  } catch (e) {
    process.stderr.write(
      `[mcp-ssh-manager] plugin startup failed: ${e.message}\n`
    );
    return {
      "tool.execute.before": _sshNudge(ctx),
    };
  }

  const toolDefs = {};

  for (const mcpTool of bridge.tools || []) {
      const schema = mcpTool.inputSchema || {
        type: "object",
        properties: {},
        required: [],
      };

      const shape = _buildShape(schema);

      // Use tool() — the official entry point (pass-through, but guarantees
      // the definition matches what OpenCode expects).
      toolDefs[mcpTool.name] = tool({
        description: mcpTool.description || "",
        args: shape,
        async execute(args) {
          try {
            return await bridge.callTool(mcpTool.name, args);
          } catch (err) {
            return `Error: ${err.message}`;
          }
        },
      });
    }

    return {
      tool: toolDefs,
      "tool.execute.before": _sshNudge(ctx),
    };
  };

/**
 * Hook: when the model calls Bash with a raw `ssh` command, show a toast
 * reminder to use the `ssh_execute` MCP tool instead.
 * (Ports the Codex hooks/prompt_mcp_ssh.py nudge to OpenCode's plugin API.)
 */
function _sshNudge(ctx) {
  return async (input, output) => {
    if (input.tool === "bash") {
      const cmd = output.args?.command;
      if (typeof cmd === "string" && /^\s*ssh\s+[^\s]/.test(cmd)) {
        try {
          ctx.client?.tui?.showToast?.({
            body: {
              message:
                "Tip: use ssh_execute from mcp-ssh-manager instead of raw ssh",
              variant: "info",
            },
          });
        } catch {
          /* non-critical */
        }
      }
    }
  };
}

export default MCPSSHManagerPlugin;

if (typeof process !== "undefined") {
  process.on("exit", () => bridge?.stop());
}
