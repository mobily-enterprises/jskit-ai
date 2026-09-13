import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { confidenceFlagsDefinition, confidenceExpDefinition } from "../shared/confidence.js";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";

const origin = "https://mcp.confidence.dev";
const oauth = Object.freeze({ issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`,
  registration_endpoint: `${origin}/register`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });

function provider(definition, path) {
  return Object.freeze({
    ...definition, oauth, oauthResource: `${origin}/mcp`, apiOrigins: [origin], checkOperation: "tools.list", exchange: exchangeMcp,
    operations: Object.fromEntries(Object.entries(mcpOperations(() => `${origin}/mcp/${path}`)).map(([name, operation]) => [name, { ...operation, scopes: ["openid"] }]))
  });
}
const confidenceFlagsProvider = provider(confidenceFlagsDefinition, "flags");
const confidenceExpProvider = provider(confidenceExpDefinition, "experiments");
const registrationSchema = createSchema({ ...mcpRegistrationFields,
  scopes: { type: "array", required: true, minLength: 1, items: { type: "string", enum: confidenceFlagsDefinition.scopes.map((scope) => scope.value) },
    validator: (scopes) => scopes.includes("openid") && new Set(scopes).size === scopes.length || "Select account identity and include each permission once." }
});

async function registerConfidenceClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("Confidence", oauth, values, options);
}

export { confidenceFlagsProvider, confidenceExpProvider, registerConfidenceClient };
