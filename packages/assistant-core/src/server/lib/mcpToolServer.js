import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// An application's actions as a Model Context Protocol server's tools: one JSON-RPC message in, its answer out, for
// the person in the call's context. Every action that person may run is a tool of its own, with its input schema and
// hints (read-only, destructive, reaching outside), so a client asks before a change as it asks of any MCP server. The
// transport (an HTTP route, its sign-in) is the caller's; this server keeps nothing between messages.

// The protocol versions it answers in, newest first; a client asking for another gets the newest.
const MCP_PROTOCOL_VERSIONS = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26"]);
const DEFAULT_TOOL_PAGE_SIZE = 50;
const JSON_RPC_ERRORS = Object.freeze({ invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602 });

/**
 * The catalogue options a remote client's catalogue is made with: every action is a tool of its own (no discovery
 * tools), an action without an output schema is one too, and a result may be larger than in a model's own turn.
 */
const MCP_TOOL_CATALOG_OPTIONS = Object.freeze({
  maxDirectTools: Number.MAX_SAFE_INTEGER,
  includeActionsWithoutOutput: true,
  maxToolResultBytes: 256 * 1024
});

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** A tool descriptor of the catalogue as MCP describes a tool. */
function toMcpTool(descriptor) {
  const hints = descriptor.hints || {};
  const readOnly = hints.readOnly === true;
  return {
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: descriptor.parameters,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly && hints.destructive === true,
      idempotentHint: readOnly,
      openWorldHint: hints.sendsOutside === true
    }
  };
}

// A page's cursor is where the next page starts, so it holds no person's data and survives a restart.
const encodeCursor = (offset) => Buffer.from(String(offset), "utf8").toString("base64url");

/** Where the page a cursor names starts, or null for a cursor this server did not give. */
function decodeCursor(cursor, total) {
  if (cursor === undefined) return 0;
  if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,16}$/u.test(cursor)) return null;
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^[1-9][0-9]{0,8}$/u.test(text)) return null;
  const offset = Number(text);
  return offset < total ? offset : null;
}

/**
 * @param {object} options
 * @param {{ resolveToolSet: Function, executeToolCall: Function }} options.catalog The person's tools: a service tool
 *   catalogue made with MCP_TOOL_CATALOG_OPTIONS.
 * @param {{ name: string, version: string }} options.serverInfo
 * @param {number} [options.pageSize] Tools in one tools/list page.
 */
function createMcpToolServer({ catalog, serverInfo, pageSize = DEFAULT_TOOL_PAGE_SIZE }) {
  // readable-check: allow method-probe - input validation: the caller hands over a tool catalogue
  if (!catalog || typeof catalog.resolveToolSet !== "function" || typeof catalog.executeToolCall !== "function") {
    throw new TypeError("createMcpToolServer requires a tool catalogue.");
  }
  if (!isRecord(serverInfo) || !normalizeText(serverInfo.name) || !normalizeText(serverInfo.version)) {
    throw new TypeError("createMcpToolServer requires serverInfo with a name and a version.");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new TypeError("createMcpToolServer pageSize must be a positive integer.");

  // Unsaved actions stay out: a remote client keeps what it calls and what they answer.
  const toolSetFor = (context) => catalog.resolveToolSet(context, { offerUnsaved: false });

  function listTools(id, params, context) {
    const tools = toolSetFor(context).tools;
    const offset = decodeCursor(params.cursor, tools.length);
    if (offset === null) return rpcError(id, JSON_RPC_ERRORS.invalidParams, "Invalid cursor.");
    const next = offset + pageSize;
    return rpcResult(id, {
      tools: tools.slice(offset, next).map(toMcpTool),
      ...(next < tools.length ? { nextCursor: encodeCursor(next) } : {})
    });
  }

  async function callTool(id, params, context) {
    const name = normalizeText(params.name);
    const args = params.arguments;
    if (!name || !isRecord(args)) {
      return rpcError(id, JSON_RPC_ERRORS.invalidParams, "tools/call needs a tool name and an arguments object.");
    }
    const toolSet = toolSetFor(context);
    if (!toolSet.byName.has(name)) return rpcError(id, JSON_RPC_ERRORS.invalidParams, `Unknown tool: ${name}`);
    const outcome = await catalog.executeToolCall({ toolName: name, argumentsText: JSON.stringify(args), context, toolSet });
    return outcome.ok
      ? rpcResult(id, { content: [{ type: "text", text: JSON.stringify(outcome.result ?? null) }], isError: false })
      : rpcResult(id, { content: [{ type: "text", text: outcome.error.message }], isError: true });
  }

  /**
   * One JSON-RPC message's answer, or null for a notification, which has none.
   * @param {unknown} message
   * @param {object} context The person's action context: actor, permissions, surface, workspace.
   */
  async function handle(message, context = {}) {
    if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return rpcError(isRecord(message) ? message.id : null, JSON_RPC_ERRORS.invalidRequest,
        Array.isArray(message) ? "Batches are not supported." : "Invalid JSON-RPC request.");
    }
    if (!Object.hasOwn(message, "id")) return null;
    const { id, method } = message;
    const params = isRecord(message.params) ? message.params : {};
    if (method === "initialize") {
      const asked = normalizeText(params.protocolVersion);
      return rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: normalizeText(serverInfo.name), version: normalizeText(serverInfo.version) }
      });
    }
    if (method === "ping") return rpcResult(id, {});
    if (method === "tools/list") return listTools(id, params, context);
    if (method === "tools/call") return callTool(id, params, context);
    return rpcError(id, JSON_RPC_ERRORS.methodNotFound, `Method not found: ${method}`);
  }

  return Object.freeze({ handle });
}

export { MCP_PROTOCOL_VERSIONS, MCP_TOOL_CATALOG_OPTIONS, createMcpToolServer };
