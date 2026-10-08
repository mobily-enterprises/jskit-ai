import { isDeepStrictEqual } from "node:util";

export const CLAUDE_APPLICATION_TOOL_SERVER = "application";

// The CLI carries this SDK MCP exchange over its existing control pipe. There
// is no listening socket or separate tool process. The shared executor owns effects.
export async function claudeApplicationToolResponse(request, { schemas, turn, signal, assertCurrent, onExecutionFailure }) {
  if (request?.subtype !== "mcp_message" || request.server_name !== CLAUDE_APPLICATION_TOOL_SERVER ||
      request.message?.jsonrpc !== "2.0") throw new Error("This Claude control request is not an application tool exchange.");
  const message = request.message;
  signal.throwIfAborted();
  let result;
  switch (message.method) {
    case "initialize":
      result = { protocolVersion: "2025-11-25", capabilities: { tools: {} },
        serverInfo: { name: CLAUDE_APPLICATION_TOOL_SERVER, version: "1.0.0" } };
      break;
    case "notifications/initialized":
    case "ping":
      result = {};
      break;
    case "tools/list":
      result = { tools: schemas.map(({ function: tool }) => ({ name: tool.name, description: tool.description,
        inputSchema: tool.parameters })) };
      break;
    case "tools/call": {
      const params = message.params;
      const id = params?._meta?.["claudecode/toolUseId"];
      const native = turn?.nativeTools.get(id);
      if (!turn?.admitted || !turn.tools || !native || native.name !== `mcp__${CLAUDE_APPLICATION_TOOL_SERVER}__${params.name}` ||
          !isDeepStrictEqual(native.input, params.arguments || {})) {
        throw new Error("Claude's application call does not match an admitted native tool use. Update Claude if its tool identity is unavailable.");
      }
      // Optional supplied-owner checks run after the unchanged native-use
      // validation. Protocol/stale refusals are not owned executor failures.
      assertCurrent?.(native);
      let value;
      try {
        value = await turn.tools.execute({ id, name: params.name, arguments: JSON.stringify(params.arguments || {}) }, { signal, messageId: native.messageId });
      } catch (error) {
        onExecutionFailure?.(error, native);
        throw error;
      }
      result = { content: [{ type: "text", text: JSON.stringify(value) }], isError: value.ok === false };
      break;
    }
    default:
      throw new Error("Unsupported Claude application tool protocol method.");
  }
  return { mcp_response: { jsonrpc: "2.0", ...(message.id === undefined ? {} : { id: message.id }), result } };
}
