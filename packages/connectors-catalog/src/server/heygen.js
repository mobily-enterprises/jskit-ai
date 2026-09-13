import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";
import { heygenDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const heygenApiProvider = Object.freeze({
  ...heygenDefinition, apiOrigins: ["https://api.heygen.com"],
  apiKey: { headers: (key) => ({ "x-api-key": key }) },
  checkOperation: "profile.read",
  operations: {
    "profile.read": jsonOperation("https://api.heygen.com/v3/users/me", {},
      (result) => typeof result?.data?.username === "string"),
    "voices.list": jsonOperation("https://api.heygen.com/v3/voices", {
      limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
      token: { type: "string", maxLength: 4096 },
      type: { type: "string", enum: ["public", "private"], defaultTo: "public" },
      engine: { type: "string", maxLength: 100 },
      language: { type: "string", maxLength: 100 },
      gender: { type: "string", enum: ["male", "female"] }
    }, (result) => Array.isArray(result?.data) && typeof result.has_more === "boolean")
  }
});
const mcpEndpoint = "https://mcp.heygen.com/mcp/v1/";
const oauth = Object.freeze({
  issuer: "https://api2.heygen.com",
  authorization_endpoint: "https://api2.heygen.com/v1/oauth/authorize",
  token_endpoint: "https://api2.heygen.com/v1/oauth/token",
  registration_endpoint: "https://api2.heygen.com/v1/oauth/register",
  response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
});
const heygenProvider = Object.freeze({
  ...heygenApiProvider, oauth, oauthResource: "https://mcp.heygen.com",
  apiOrigins: ["https://api.heygen.com", "https://mcp.heygen.com"],
  checkOperation: (method) => method === "oauth2" ? "tools.list" : "profile.read",
  operations: {
    ...Object.fromEntries(Object.entries(heygenApiProvider.operations).map(([name, operation]) =>
      [name, { ...operation, authenticationMethods: ["api-key"] }])),
    ...Object.fromEntries(Object.entries(mcpOperations(() => mcpEndpoint)).map(([name, operation]) =>
      [name, { ...operation, authenticationMethods: ["oauth2"], scopes: ["openid"] }]))
  },
  exchange(address, options, context) {
    return address === mcpEndpoint ? exchangeMcp(address, options, context) : context.request(address, options);
  }
});
const registrationSchema = createSchema(mcpRegistrationFields);

async function registerHeyGenClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("HeyGen", oauth, { ...values, scopes: heygenDefinition.scopes.map((scope) => scope.value) }, options);
}

export { heygenProvider, registerHeyGenClient };
