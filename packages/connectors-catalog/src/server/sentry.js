import { sentryDefinition } from "../shared/tokens.js";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";

const oauth = Object.freeze({
  issuer: "https://mcp.sentry.dev", authorization_endpoint: "https://mcp.sentry.dev/oauth/authorize",
  token_endpoint: "https://mcp.sentry.dev/oauth/token", registration_endpoint: "https://mcp.sentry.dev/oauth/register",
  response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
});
const registrationSchema = createSchema({ ...mcpRegistrationFields,
  scopes: { type: "array", required: true, minLength: 1,
    items: { type: "string", enum: sentryDefinition.scopes.map((scope) => scope.value) } }
});
async function registerSentryClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("Sentry", oauth, values, options);
}
function sentryEndpoint(settings) {
  const values = validateSchemaPayload({ schema: sentryDefinition.settingsSchema, mode: "replace" }, settings, { statusCode: 422 });
  return `https://mcp.sentry.dev/mcp/${values.organizationSlug}${values.projectSlug ? `/${values.projectSlug}` : ""}`;
}

const sentryProvider = Object.freeze({
  ...sentryDefinition, oauth, oauthResource: sentryEndpoint,
  apiOrigins: ["https://mcp.sentry.dev"], checkOperation: "tools.list",
  exchange: exchangeMcp, operations: mcpOperations(sentryEndpoint)
});
export { sentryProvider, registerSentryClient };
