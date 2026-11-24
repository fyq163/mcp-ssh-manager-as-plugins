export const MCPSSHManagerRpc = {
  id: "mcp-ssh-manager",
  methods: {},
  events: {
    sshNudge: {
      schema: {
        type: "object",
        properties: {
          message: { type: "string" },
          sessionID: { type: "string" },
        },
        required: ["message", "sessionID"],
        additionalProperties: false,
      },
    },
  },
};
