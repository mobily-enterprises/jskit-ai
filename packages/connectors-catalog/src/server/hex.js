import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { hexDefinition, hexHosts, hexEndpointField } from "../shared/hex.js";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";

const origin = (settings) => `https://${hexHosts[settings.endpoint]}`;
const resource = (settings) => `${origin(settings)}/mcp`;
const oauth = (settings) => {
  const issuer = `https://auth.${hexHosts[settings.endpoint]}`;
  return { issuer, authorization_endpoint: `${issuer}/oauth2/authorize`, token_endpoint: `${issuer}/oauth2/token`,
    registration_endpoint: `${issuer}/oauth2/register`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] };
};
const hexProvider = Object.freeze({
  ...hexDefinition, oauth, oauthResource: resource, apiOrigins: (settings) => [origin(settings)],
  checkOperation: "tools.list", exchange: exchangeMcp,
  operations: Object.fromEntries(Object.entries(mcpOperations(resource)).map(([name, operation]) => [name, { ...operation, scopes: ["openid"] }]))
});
const registrationSchema = createSchema({ endpoint: hexEndpointField, ...mcpRegistrationFields,
  scopes: { type: "array", required: true, minLength: 1, items: { type: "string", enum: hexDefinition.scopes.map((scope) => scope.value) },
    validator: (scopes) => scopes.includes("openid") && new Set(scopes).size === scopes.length || "Select account identity and include each permission once." }
});

async function registerHexClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("Hex", oauth(values), values, options);
}

export { hexProvider, registerHexClient };
