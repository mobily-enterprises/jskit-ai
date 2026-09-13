import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { figmaDefinition } from "../shared/figma.js";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";

const resource = "https://mcp.figma.com/mcp";
const oauth = Object.freeze({
  issuer: "https://api.figma.com", authorization_endpoint: "https://www.figma.com/oauth/mcp",
  token_endpoint: "https://api.figma.com/v1/oauth/token", registration_endpoint: "https://api.figma.com/v1/oauth/mcp/register",
  response_types_supported: ["code"], authorization_response_iss_parameter_supported: true
});
const figmaProvider = Object.freeze({
  ...figmaDefinition, oauth, oauthResource: resource, apiOrigins: ["https://mcp.figma.com"],
  checkOperation: "tools.list", exchange: exchangeMcp, operations: mcpOperations(() => resource)
});
const registrationSchema = createSchema(mcpRegistrationFields);

async function registerFigmaClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("Figma", oauth, { ...values, scopes: ["mcp:connect"] }, options);
}

export { figmaProvider, registerFigmaClient };
