import { spawn } from "node:child_process";
import os from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MCPSSHManagerRpc } from "./rpc.js";

const REQUEST_TIMEOUT_MS = 30_000;
const SSH_NUDGE =
  "Tip: use ssh_execute from mcp-ssh-manager instead of raw ssh";

function findMcpServerEntry() {
  const pluginDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(pluginDir, "../../../src/index.js"),
    join(pluginDir, "src", "index.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function loadInstalledConfig() {
  const pluginDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(pluginDir, "mcp-ssh-manager.config.json"),
    resolve(pluginDir, "../../../mcp-ssh-manager.config.json"),
  ];

  try {
    for (const configPath of candidates) {
      if (!existsSync(configPath)) continue;
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      return config && typeof config === "object" ? config : {};
    }
  } catch {
    // A malformed optional config must not prevent OpenCode from loading.
  }
  return {};
}

function normalizeInputSchema(schema) {
  if (
    schema &&
    typeof schema === "object" &&
    !Array.isArray(schema) &&
    schema.type === "object"
  ) {
    return schema;
  }

  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

export function isRawSshCommand(command) {
  return typeof command === "string" && /^\s*ssh\s+\S/.test(command);
}

function isRawSshToolInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }

  return isRawSshCommand(input.command);
}

export function createSSHNudgeHook(rpcRegistration) {
  return async (event) => {
    if (
      event.tool.toLowerCase() !== "bash" ||
      !isRawSshToolInput(event.input)
    ) {
      return;
    }

    await rpcRegistration.events.emit("sshNudge", {
      message: SSH_NUDGE,
      sessionID: event.sessionID,
    });
  };
}

class MCPBridge {
  constructor() {
    this.child = null;
    this.buffer = "";
    this.pending = new Map();
    this.msgId = 0;
    this.tools = [];
    this.ready = false;
    this.starting = null;
  }

  getNodeCommand() {
    const override = process.env.MCP_SSH_MANAGER_NODE?.trim();
    if (override) return override;

    const installed = loadInstalledConfig();
    return typeof installed.nodePath === "string" && installed.nodePath.trim()
      ? installed.nodePath.trim()
      : "node";
  }

  getEnv() {
    const env = { ...process.env };
    const nodePath = this.getNodeCommand();

    if (isAbsolute(nodePath)) {
      const nodeDir = dirname(nodePath);
      const currentPath = env.PATH || "";
      if (!currentPath.split(delimiter).includes(nodeDir)) {
        env.PATH = [nodeDir, currentPath].filter(Boolean).join(delimiter);
      }
    }

    if (!env.SSH_CONFIG_PATH) {
      env.SSH_CONFIG_PATH = join(
        os.homedir(),
        ".config/mcp-ssh-manager/ssh-config.toml",
      );
    }

    return env;
  }

  getSpawnCommand() {
    const entry = findMcpServerEntry();
    if (entry) {
      return { command: this.getNodeCommand(), args: [entry] };
    }

    return { command: "npx", args: ["-y", "mcp-ssh-manager"] };
  }

  start() {
    if (this.ready) return Promise.resolve(this.tools);
    if (this.starting) return this.starting;

    this.starting = this._start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async _start() {
    const { command, args } = this.getSpawnCommand();
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.getEnv(),
      cwd: os.homedir(),
    });
    this.child = child;
    this.buffer = "";

    child.stdout.on("data", (data) => {
      this.buffer += data.toString();
      this._dispatch();
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(`[mcp-ssh-manager] ${data}`);
    });

    child.on("error", (error) => {
      const hint =
        error.code === "ENOENT" && command !== "npx"
          ? ` Node.js executable "${command}" was not found; rerun the installer or set MCP_SSH_MANAGER_NODE to its absolute path.`
          : "";
      process.stderr.write(
        `[mcp-ssh-manager] spawn error: ${error.message}.${hint}\n`,
      );
      this.child = null;
      this.ready = false;
      this._rejectPending(new Error(`MCP server spawn failed: ${error.message}`));
    });

    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        process.stderr.write(`[mcp-ssh-manager] exited (${code})\n`);
      }
      this.child = null;
      this.ready = false;
      this.tools = [];
      this._rejectPending(new Error("MCP server process exited"));
    });

    const initialized = await this._request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "opencode", version: "2" },
    });
    if (!initialized) {
      throw new Error("MCP server returned an empty initialize response");
    }

    this._sendNotification("notifications/initialized");
    const response = await this._request("tools/list", {});
    this.tools = Array.isArray(response?.tools) ? response.tools : [];
    this.ready = true;
    process.stderr.write(
      `[mcp-ssh-manager] ${this.tools.length} tools discovered\n`,
    );
    return this.tools;
  }

  _sendNotification(method, params = {}) {
    this._write({ jsonrpc: "2.0", method, params });
  }

  _write(message) {
    if (!this.child?.stdin?.writable) {
      throw new Error("MCP server not running");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _request(method, params = {}) {
    return new Promise((resolveRequest, rejectRequest) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        rejectRequest(new Error(`MCP request ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveRequest(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectRequest(error);
        },
      });

      try {
        this._write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        rejectRequest(error);
      }
    });
  }

  _dispatch() {
    let newline;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      if (typeof message.id === "number" && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(message.error.message || "MCP error"));
        } else {
          entry.resolve(message.result);
        }
        continue;
      }

      if (message.method === "notifications/message") {
        const params = message.params || {};
        const data =
          typeof params.data === "string"
            ? params.data
            : JSON.stringify(params.data ?? "");
        process.stderr.write(`[mcp] ${params.level || "info"}: ${data}\n`);
      }
    }
  }

  _rejectPending(error) {
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  async ensureReady() {
    if (this.ready) return;
    await this.start();
  }

  async callTool(name, args) {
    await this.ensureReady();
    const response = await this._request("tools/call", {
      name,
      arguments: args,
    });

    if (response?.isError) {
      const first = (response.content || []).find(
        (content) => content.type === "text",
      );
      throw new Error(first?.text || "Tool returned an error");
    }

    const textParts = (response?.content || [])
      .filter((content) => content.type === "text")
      .map((content) => content.text);
    return textParts.length > 0
      ? textParts.join("\n")
      : JSON.stringify(response?.content || {});
  }

  stop() {
    this.child?.kill();
    this.child = null;
    this.ready = false;
    this.tools = [];
    this._rejectPending(new Error("MCP bridge stopped"));
  }
}

// V2 plugins are structural { id, setup } definitions. Keeping the entrypoint
// dependency-free lets the one-line installer ship it without npm install.
export const MCPSSHManagerPlugin = {
  id: "mcp-ssh-manager",
  async setup(context) {
    const bridge = new MCPBridge();
    let rpcRegistration;
    let toolRegistration;
    let hookRegistration;

    try {
      const tools = await bridge.start();
      rpcRegistration = await context.rpc.register(MCPSSHManagerRpc, {});

      toolRegistration = await context.tool.transform((editor) => {
        for (const mcpTool of tools) {
          editor.add({
            name: mcpTool.name,
            description: mcpTool.description || "",
            input: normalizeInputSchema(mcpTool.inputSchema),
            async execute(args) {
              try {
                return {
                  content: await bridge.callTool(mcpTool.name, args),
                };
              } catch (error) {
                return {
                  content: `Error: ${error.message}`,
                };
              }
            },
          });
        }
      });

      hookRegistration = await context.tool.hook(
        "execute.before",
        createSSHNudgeHook(rpcRegistration),
      );

      process.stderr.write(
        `[mcp-ssh-manager] OpenCode V2 plugin ready (${tools.length} tools, SSH hook enabled)\n`,
      );
    } catch (error) {
      bridge.stop();
      await hookRegistration?.dispose();
      await toolRegistration?.dispose();
      await rpcRegistration?.dispose();
      throw error;
    }

    return async () => {
      await hookRegistration?.dispose();
      await toolRegistration?.dispose();
      await rpcRegistration?.dispose();
      bridge.stop();
    };
  },
};

export default MCPSSHManagerPlugin;
