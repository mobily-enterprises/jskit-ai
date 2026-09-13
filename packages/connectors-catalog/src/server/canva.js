import { canvaDefinition } from "../shared/canva.js";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";

const canvaProvider = Object.freeze({
  ...canvaDefinition,
  oauth: { issuer: "https://mcp.canva.com", authorization_endpoint: "https://mcp.canva.com/authorize",
    token_endpoint: "https://mcp.canva.com/token", response_types_supported: ["code"] },
  oauthResource: "https://mcp.canva.com", apiOrigins: ["https://mcp.canva.com"],
  requestTimeoutMs: 60_000, checkOperation: "tools.list", exchange: exchangeMcp,
  operations: mcpOperations(() => "https://mcp.canva.com/mcp")
});

export { canvaProvider };
