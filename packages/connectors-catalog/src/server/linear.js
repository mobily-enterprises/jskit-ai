import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";
import { linearDefinition } from "../shared/tokens.js";
import { graphqlOperation } from "./graphqlOperation.js";

function queryOperation(query, fields, validateData) {
  return { ...graphqlOperation("https://api.linear.app/graphql", query, fields, validateData), scopes: ["read"] };
}

const linearProvider = Object.freeze({
  ...linearDefinition, apiOrigins: ["https://api.linear.app", "https://mcp.linear.app"],
  oauth: {
    issuer: "https://linear.app",
    authorization_endpoint: "https://linear.app/oauth/authorize",
    token_endpoint: "https://api.linear.app/oauth/token"
  },
  scopeSeparator: ",",
  authorizationParameters: { actor: "user", prompt: "consent" },
  async normalizeTokenResponse(response) {
    if (!response.ok) return response;
    let value;
    try { value = await response.clone().json(); } catch {
      throw new ConnectorError("connector_response_invalid", "Linear returned an invalid token response.", { statusCode: 502 });
    }
    // Linear accepts commas at authorization but returns space-separated grants.
    const scopes = typeof value?.scope === "string" ? value.scope.split(" ").filter(Boolean) : value?.scope;
    if (!Array.isArray(scopes) || !scopes.every(scope => typeof scope === "string" && /^[^\s,]+$/u.test(scope))) {
      throw new ConnectorError("connector_response_invalid", "Linear returned an invalid permission grant.", { statusCode: 502 });
    }
    return Response.json({ ...value, scope: scopes.join(",") }, { status: response.status });
  },
  apiKey: { headers: (key) => ({ Authorization: key }) },
  checkOperation: "profile.read",
  exchange(address, options, context) {
    if (address === "https://mcp.linear.app/mcp") {
      const headers = context.apiKey === undefined ? options.headers : { ...options.headers, Authorization: `Bearer ${context.apiKey}` };
      return exchangeMcp(address, { ...options, headers }, context);
    }
    return context.request(address, options);
  },
  operations: {
    ...Object.fromEntries(Object.entries(mcpOperations(() => "https://mcp.linear.app/mcp")).map(([name, operation]) =>
      [name, { ...operation, scopes: ["read"] }])),
    "profile.read": queryOperation("query ConnectorViewer { viewer { id name email } }", {},
      (data) => typeof data?.viewer?.id === "string" && typeof data.viewer.name === "string"),
    "issues.list": queryOperation("query ConnectorIssues($first: Int!, $after: String) { issues(first: $first, after: $after) { nodes { id identifier title } pageInfo { hasNextPage endCursor } } }", {
      first: { type: "integer", min: 1, max: 100, defaultTo: 50 },
      after: { type: "string", maxLength: 4096 }
    }, (data) => Array.isArray(data?.issues?.nodes) && typeof data.issues.pageInfo?.hasNextPage === "boolean")
  }
});
export { linearProvider };
