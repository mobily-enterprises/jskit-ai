import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { miroDefinition } from "../shared/miro.js";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";

const resource = "https://mcp.miro.com/";
const oauth = Object.freeze({
  issuer: resource, authorization_endpoint: "https://mcp.miro.com/authorize",
  token_endpoint: "https://mcp.miro.com/token", registration_endpoint: "https://mcp.miro.com/register",
  response_types_supported: ["code"]
});
const miroProvider = Object.freeze({
  ...miroDefinition, oauth, oauthResource: resource, apiOrigins: ["https://mcp.miro.com"],
  checkOperation: "tools.list", exchange: exchangeMcp, operations: mcpOperations(() => resource)
});
const registrationSchema = createSchema({
  ...mcpRegistrationFields,
  scopes: { type: "array", required: true, minLength: 1,
    items: { type: "string", enum: miroDefinition.scopes.map((scope) => scope.value) },
    validator: (scopes) => scopes.length > 0 && new Set(scopes).size === scopes.length || "Select at least one permission and include each once." }
});

async function registerMiroClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("Miro", oauth, values, options);
}

export { miroProvider, registerMiroClient };
