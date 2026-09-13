import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { jsonOperation } from "./jsonOperation.js";

function mcpOperations(endpoint) {
  const operation = (method, fields) => {
    const definition = jsonOperation(endpoint, fields, undefined, "POST");
    return { ...definition, request(input, settings) {
      const request = definition.request(input, settings);
      return { ...request, body: { method, params: request.body } };
    } };
  };
  return {
    "tools.list": operation("tools/list", { cursor: { type: "string", minLength: 1, maxLength: 4096 } }),
    "tools.call": operation("tools/call", {
      name: { type: "string", required: true, minLength: 1, maxLength: 128,
        validator: (value) => /^[a-z0-9_.-]+$/iu.test(value) || "Enter an MCP tool name using letters, digits, underscores, dots or hyphens." },
      arguments: { type: "object", required: true }
    })
  };
}

async function exchangeMcp(endpoint, { headers, signal, body }, { fetchImpl }) {
  const client = new Client({ name: "jskit-connectors", version: "0.1.0" }, { capabilities: {} });
  let cleanup = false;
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    reconnectionOptions: { initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1, maxRetries: 0 },
    fetch: async (address, init = {}) => {
      if (new URL(String(address)).href !== endpoint) {
        throw new ConnectorError("connector_destination_invalid", "The MCP transport requested an unexpected destination.");
      }
      const requestHeaders = new Headers(init.headers);
      // Keep MCP's Accept/protocol/session headers, and bind credentials to this endpoint only.
      requestHeaders.set("Authorization", headers.Authorization);
      const requestSignal = cleanup ? AbortSignal.timeout(2000) : AbortSignal.any([...(init.signal ? [init.signal] : []), signal]);
      const response = await fetchImpl(address, { ...init, headers: requestHeaders, credentials: "omit", redirect: "error", signal: requestSignal });
      if (!response.ok && !(response.status === 405 && ["GET", "DELETE"].includes(init.method))) {
        await response.body?.cancel();
        const error = new Error("MCP request failed.");
        error.statusCode = response.status;
        throw error;
      }
      return response;
    }
  });
  try {
    signal.throwIfAborted();
    await client.connect(transport, { signal });
    if (body.method === "tools/list") return await client.listTools(body.params, { signal });
    return await client.callTool(body.params, undefined, { signal });
  } finally {
    cleanup = true;
    // Closing a local client alone does not delete a server-side MCP session.
    try { await transport.terminateSession(); } catch { /* Cleanup failure must not replace the operation's result. */ }
    await client.close();
  }
}

export { mcpOperations, exchangeMcp };
