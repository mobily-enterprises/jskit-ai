import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { atlassianDefinition } from "../shared/atlassian.js";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";

const resource = "https://mcp.atlassian.com/v2/mcp";
const oauth = Object.freeze({
  issuer: "https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3",
  authorization_endpoint: "https://auth.atlassian.com/authorize",
  token_endpoint: "https://auth.atlassian.com/oauth/token",
  registration_endpoint: atlassianDefinition.setup.clientRegistrationEndpoint,
  response_types_supported: ["code"]
});
const atlassianProvider = Object.freeze({
  ...atlassianDefinition, oauth, oauthResource: resource,
  apiOrigins: ["https://mcp.atlassian.com"], checkOperation: "tools.list", exchange: exchangeMcp,
  operations: mcpOperations(() => `${resource}?tools=all`)
});
const registrationSchema = createSchema({
  ...mcpRegistrationFields,
  scopes: { type: "array", required: true, minLength: 1,
    items: { type: "string", enum: atlassianDefinition.scopes.map((scope) => scope.value) },
    validator: (scopes) => scopes.length > 0 && new Set(scopes).size === scopes.length || "Select at least one permission and include each once." }
});

async function registerAtlassianClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("Atlassian", oauth, values, options);
}

export { atlassianProvider, registerAtlassianClient };
