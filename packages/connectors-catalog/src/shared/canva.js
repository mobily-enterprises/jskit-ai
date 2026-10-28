import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

function validateCanvaClientId(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.pathname !== "/" && !url.username && !url.password && !url.search && !url.hash && url.href === value) return true;
  } catch { /* Report a field error below. */ }
  return "Use the exact HTTPS URL of your client metadata JSON, including its path, without credentials, query or fragment.";
}

const canvaDefinition = Object.freeze({
  id: "canva", name: "Canva", description: "jskit.connectors.canva.description",
  accountModes: ["assistant"], authenticationMethods: ["oauth2"], oauthClientAuthenticationMethods: ["none"],
  clientIdLabel: "jskit.connectors.canva.clientIdLabel", clientIdHint: "jskit.connectors.canva.clientIdHint",
  validateClientId: validateCanvaClientId,
  scopes: [
    { value: "profile:read", label: "jskit.connectors.canva.scopes.profileRead.label", recommended: true },
    { value: "design:meta:read", label: "jskit.connectors.canva.scopes.designMetaRead.label", recommended: true },
    { value: "design:content:write", label: "jskit.connectors.canva.scopes.designContentWrite.label" },
    { value: "design:content:read", label: "jskit.connectors.canva.scopes.designContentRead.label", recommended: true },
    { value: "folder:read", label: "jskit.connectors.canva.scopes.folderRead.label", recommended: true },
    { value: "folder:write", label: "jskit.connectors.canva.scopes.folderWrite.label" },
    { value: "brandtemplate:content:read", label: "jskit.connectors.canva.scopes.brandtemplateContentRead.label" },
    { value: "brandtemplate:meta:read", label: "jskit.connectors.canva.scopes.brandtemplateMetaRead.label" },
    { value: "brandtemplate:content:write", label: "jskit.connectors.canva.scopes.brandtemplateContentWrite.label" },
    { value: "comment:write", label: "jskit.connectors.canva.scopes.commentWrite.label" },
    { value: "comment:read", label: "jskit.connectors.canva.scopes.commentRead.label" },
    { value: "asset:read", label: "jskit.connectors.canva.scopes.assetRead.label" },
    { value: "asset:write", label: "jskit.connectors.canva.scopes.assetWrite.label" },
    { value: "brandkit:read", label: "jskit.connectors.canva.scopes.brandkitRead.label" },
    { value: "help:answers:read", label: "jskit.connectors.canva.scopes.helpAnswersRead.label" },
    { value: "help:answers:write", label: "jskit.connectors.canva.scopes.helpAnswersWrite.label" }
  ],
  setup: {
    url: "https://www.canva.dev/docs/mcp/",
    createClientMetadata: createCanvaClientMetadata,
    steps: [
      "Open the Canva MCP guide and follow Register your redirect URI to its Waitlist form. Apply with the exact callback URL and wait for Canva's approval.",
      "Choose a public HTTPS document URL owned by your application, including a path such as /oauth/canva.json. Enter it in Client metadata URL and confirm the suggested callback above. Copy the client metadata JSON below and serve it at that exact document URL with Content-Type application/json and no login requirement. CLI users can use createCanvaClientMetadata.",
      "Save configuration, then use Set callback in Env to save the exact approved callback under the displayed Callback URL reference. The metadata URL and callback are different addresses. This client has no secret.",
      "Choose the design and content permissions the assistant needs, then save. Each assistant owner must sign in to Canva and approve access through the runtime's authorization flow.",
      "Verification lists tools; the assistant host must authorize individual calls and content ownership. Saving does not publish metadata, grant approval or attach tools."
    ]
  }
});

const metadataSchema = createSchema({
  clientId: { type: "string", required: true, maxLength: 2048, validator: validateCanvaClientId },
  clientName: { type: "string", required: true, minLength: 1, maxLength: 200 },
  callbackUrl: { type: "string", required: true, validator(value) {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) &&
        !url.username && !url.password && !url.search && !url.hash || "Use an HTTPS or loopback callback without credentials, query or fragment.";
    } catch { return "Enter the callback URL served by the assistant host."; }
  } }
});

function createCanvaClientMetadata(input) {
  const { clientId, clientName, callbackUrl } = validateSchemaPayload({ schema: metadataSchema, mode: "replace" }, input, { statusCode: 422 });
  return { client_id: clientId, client_name: clientName, redirect_uris: [new URL(callbackUrl).href],
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
}

export { canvaDefinition, createCanvaClientMetadata };
