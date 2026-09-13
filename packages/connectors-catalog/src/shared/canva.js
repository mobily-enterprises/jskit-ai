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
  id: "canva", name: "Canva", description: "Discover and use Canva design tools through each assistant owner's account.",
  accountModes: ["assistant"], authenticationMethods: ["oauth2"], oauthClientAuthenticationMethods: ["none"],
  clientIdLabel: "Client metadata URL", clientIdHint: "Serve your client metadata JSON at this HTTPS URL. Canva must approve the callback; this setup uses no client secret.",
  validateClientId: validateCanvaClientId,
  scopes: [
    { value: "profile:read", label: "Read your profile", recommended: true },
    { value: "design:meta:read", label: "Read design information", recommended: true },
    { value: "design:content:write", label: "Create and edit designs" },
    { value: "design:content:read", label: "Read design content", recommended: true },
    { value: "folder:read", label: "Read folders", recommended: true },
    { value: "folder:write", label: "Create and edit folders" },
    { value: "brandtemplate:content:read", label: "Read brand template content" },
    { value: "brandtemplate:meta:read", label: "Read brand template information" },
    { value: "brandtemplate:content:write", label: "Create and edit brand templates" },
    { value: "comment:write", label: "Write comments" },
    { value: "comment:read", label: "Read comments" },
    { value: "asset:read", label: "Read assets" },
    { value: "asset:write", label: "Upload and edit assets" },
    { value: "brandkit:read", label: "Read brand kits" },
    { value: "help:answers:read", label: "Read help answers" },
    { value: "help:answers:write", label: "Write help answers" }
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
