import { MCPSSHManagerRpc } from "./rpc.js";

export default {
  id: "mcp-ssh-manager.tui",
  setup(context) {
    const mcpSshManager = context.client.rpc(MCPSSHManagerRpc);

    return mcpSshManager.events.on("sshNudge", (event) => {
      if (
        context.location &&
        event.location.directory !== context.location.directory
      ) {
        return;
      }

      context.ui.toast.show({
        title: "MCP SSH Manager",
        message: event.data.message,
        variant: "info",
        duration: 5000,
      });
    });
  },
};
