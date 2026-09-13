import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";
import { amplitudeDefinition } from "../shared/amplitude.js";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";

const origin = (settings) => settings.region === "eu" ? "https://mcp.eu.amplitude.com" : "https://mcp.amplitude.com";
const oauth = (settings) => ({ issuer: origin(settings), authorization_endpoint: `${origin(settings)}/authorize`,
  token_endpoint: `${origin(settings)}/token`, registration_endpoint: amplitudeDefinition.setup.clientRegistrationEndpoint(settings), response_types_supported: ["code"] });
const operations = mcpOperations((settings) => `${origin(settings)}/mcp`);
const amplitudeProvider = Object.freeze({
  ...amplitudeDefinition, oauth, oauthResource: origin,
  apiOrigins: (settings) => [origin(settings)], checkOperation: "tools.list", exchange: exchangeMcp,
  operations: Object.fromEntries(Object.entries(operations).map(([name, operation]) => [name, { ...operation, scopes: ["mcp:read"] }]))
});

const registrationSchema = createSchema({
  region: { type: "string", enum: ["us", "eu"], defaultTo: "us" },
  ...mcpRegistrationFields,
  scopes: { type: "array", required: true, minLength: 1,
    items: { type: "string", enum: amplitudeDefinition.scopes.map((scope) => scope.value) },
    validator: (scopes) => scopes.includes("mcp:read") && new Set(scopes).size === scopes.length || "Select read access and include each permission once." }
});

// Explicit setup operation. Callers own authorization and secure storage of its returned secret.
async function registerAmplitudeClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("Amplitude", oauth(values), values, options);
}

export { amplitudeProvider, registerAmplitudeClient };
