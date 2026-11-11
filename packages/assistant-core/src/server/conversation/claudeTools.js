import { isDeepStrictEqual } from "node:util";
import { DEFAULT_MAX_TOOL_RESULT_BYTES } from "../lib/serviceToolCatalog.js";

export const CLAUDE_APPLICATION_TOOL_SERVER = "application";

/**
 * How large an application tool result Claude must keep whole, in characters and in tokens, or null
 * to keep Claude's own limits. Claude Code saves an MCP tool result longer than its tool's declared
 * maxResultSizeChars (50,000 characters unless declared, at most 500,000) or past
 * MAX_MCP_OUTPUT_TOKENS (25,000 unless set, or raised by Claude's own configuration) to a file, and
 * the model sees only a preview of it. A tool set whose result limit is above the catalogue's default
 * 48 KiB raises both to that limit, since a character and a token each cover at least one byte, with
 * 1 KiB for the result's {"ok":true,"result":…} envelope. At the default, Claude keeps its own.
 * @param {number | undefined} maximumResultBytes The tool set's result limit.
 */
export function claudeToolResultAllowance(maximumResultBytes) {
  return maximumResultBytes > DEFAULT_MAX_TOOL_RESULT_BYTES ? maximumResultBytes + 1024 : null;
}

/** A call from tools the conversation owns needs no supplied owner's check. */
function acceptNativeCall() {}

/** A call from tools the conversation owns fails only its own exchange. */
function ignoreExecutionFailure() {}

// The CLI carries this SDK MCP exchange over its existing control pipe. There
// is no listening socket or separate tool process. The shared executor owns effects.
export async function claudeApplicationToolResponse(request, {
  schemas,
  maximumResultBytes,
  turn,
  signal,
  assertCurrent = acceptNativeCall,
  onExecutionFailure = ignoreExecutionFailure
}) {
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
    case "tools/list": {
      const allowance = claudeToolResultAllowance(maximumResultBytes);
      result = { tools: schemas.map(({ function: tool }) => ({ name: tool.name, description: tool.description,
        inputSchema: tool.parameters, ...(allowance ? { _meta: { "anthropic/maxResultSizeChars": allowance } } : {}) })) };
      break;
    }
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
      assertCurrent(native);
      let value;
      try {
        value = await turn.tools.execute({ id, name: params.name, arguments: JSON.stringify(params.arguments || {}) }, { signal, messageId: native.messageId });
      } catch (error) {
        onExecutionFailure(error, native);
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
