import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";
import { sanityDefinition } from "../shared/mcp.js";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";

const oauth = Object.freeze({
  issuer: "https://mcp.sanity.io", authorization_endpoint: "https://mcp.sanity.io/authorize",
  token_endpoint: "https://mcp.sanity.io/token", registration_endpoint: "https://mcp.sanity.io/register",
  response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
});
const registrationSchema = createSchema({ ...mcpRegistrationFields,
  scopes: { type: "array", required: true, minLength: 1,
    items: { type: "string", enum: ["global"] },
    validator: (values) => values.length === 1 && values[0] === "global" || "Select Sanity MCP access." }
});
async function registerSanityClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("Sanity", oauth, values, options);
}

const sanityProvider = Object.freeze({
  ...sanityDefinition, oauth, oauthResource: "https://mcp.sanity.io",
  apiOrigins: ["https://mcp.sanity.io"],
  apiKey: { headers: (token) => ({ Authorization: `Bearer ${token}` }) },
  checkOperation: "tools.list",
  exchange: exchangeMcp,
  operations: mcpOperations("https://mcp.sanity.io/")
});

export { sanityProvider, registerSanityClient };
