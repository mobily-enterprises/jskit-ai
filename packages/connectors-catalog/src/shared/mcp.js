import { createSchema } from "json-rest-schema";

function validN8nServerUrl(value) {
  if (!/^https:\/\//iu.test(value) || /[\s\\?#]/u.test(value) || /\/(?:\.|%2e){1,2}(?:\/|$)/iu.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.pathname.endsWith("/mcp-server/http");
  } catch { return false; }
}

function validN8nOAuthDiscovery(value) {
  try {
    if (!validN8nServerUrl(value.resource)) return false;
    const metadata = value.oauth;
    const issuer = new URL(metadata.issuer);
    if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash) return false;
    const base = issuer.href.replace(/\/$/u, "");
    const includes = (values, item) => Array.isArray(values) && values.includes(item);
    return metadata.authorization_endpoint === `${base}/mcp-oauth/authorize` &&
      metadata.token_endpoint === `${base}/mcp-oauth/token` && metadata.registration_endpoint === `${base}/mcp-oauth/register` &&
      includes(metadata.response_types_supported, "code") && includes(metadata.grant_types_supported, "authorization_code") &&
      includes(metadata.grant_types_supported, "refresh_token") && includes(metadata.token_endpoint_auth_methods_supported, "client_secret_post") &&
      includes(metadata.code_challenge_methods_supported, "S256") && Array.isArray(value.scopes) && value.scopes.length > 0 &&
      new Set(value.scopes).size === value.scopes.length && value.scopes.every((scope) =>
        typeof scope === "string" && /^[\x21\x23-\x5B\x5D-\x7E]{1,200}$/u.test(scope) && includes(metadata.scopes_supported, scope));
  } catch { return false; }
}

const n8nDefinition = Object.freeze({
  id: "n8n", name: "n8n", description: "Discover and use your n8n instance's MCP tools from an assistant.",
  accountModes: ["assistant"], authenticationMethods: ["api-key"], scopes: [],
  authenticationMethodsForSettings: (settings) => settings.oauthDiscovery ? ["oauth2", "api-key"] : ["api-key"],
  scopesForSettings: (settings) => (settings.oauthDiscovery?.scopes || []).map((value) => ({ value, label: value })),
  apiKeyReferenceLabel: "MCP access token reference",
  apiKeyReferenceHint: "Use the personal token from Instance-level MCP, not an n8n REST API key. The assistant host must authorize individual tool calls.",
  settingsSchema: createSchema({ serverUrl: { type: "string", required: true, minLength: 1, maxLength: 2048,
    validator: (value) => validN8nServerUrl(value) || "Use the HTTPS MCP server URL ending /mcp-server/http, without credentials, query or fragment." },
    oauthDiscovery: { type: "object", additionalProperties: true,
      validator: (value) => validN8nOAuthDiscovery(value) || "Discover a supported n8n OAuth authority and permissions before connecting." }
  }),
  settingsFields: [{ name: "serverUrl", label: "Server URL", placeholder: "https://automation.example.com/mcp-server/http",
    hint: "Copy the full Server URL from n8n's MCP connection details. Keep any reverse-proxy subdirectory." }],
  setup: {
    url: "https://docs.n8n.io/connect/connect-to-n8n-mcp-server",
    clientRegistrationEndpoint: (settings) => settings.oauthDiscovery?.resource === settings.serverUrl
      ? settings.oauthDiscovery.oauth.registration_endpoint : undefined,
    stepsByAuthentication: { oauth2: [
      "LIMITATIONS: Automatic Vibe64 coding-chat attachment is deferred. A separately wired CLI or assistant host can discover and invoke exposed workflows through MCP after approving the exact tool and arguments; connecting alone does not attach chat tools. This connector is not the n8n REST API or a workflow designer.",
      "In n8n, open Settings → Instance-level MCP and enable access as an instance owner or admin. Copy its full Server URL. In this editor, Discover OAuth settings reads the instance's public authority and permissions. CLI users can call discoverN8nOAuth. A server without advertised OAuth permissions is not supported by this path; use its personal API key method instead.",
      "Select OAuth and the smallest set of advertised permissions your application needs. Keep Assistant access. Enter the Suggested callback URL your application will actually serve; use the application address, not the editor dashboard. If n8n restricts Allowed callback URLs, ask its owner/admin to allow that exact URL before registration.",
      "In this editor, choose Register client and connect. This saves the client ID in configuration and the secret, callback and recovery client ID in development Env, then starts your application’s consent flow. It requires unused Env keys and an application-owned callback/setup command. Alternatively, use OAuth client registration below to send the displayed JSON in one POST with Content-Type: application/json, or call registerN8nClient from the CLI. A timeout may still have created a client; investigate before repeating registration.",
      "For manual registration only, copy client_id from the successful response into Client ID. Keep client_secret private and note any expiry. Keep env:N8N_CLIENT_SECRET and env:N8N_CALLBACK_URL (or this slot's displayed names) as references. Save configuration, use Set credential in Env for the secret, and Set callback in Env for the exact registered callback. Do not paste the complete registration response into configuration or chat.",
      "Return and click Connect account. Sign into the intended n8n account, review the requested permissions and approve access. Your application's callback completes consent. Verification initializes MCP and lists tools; it does not run a workflow. A successful client registration alone does not connect an account.",
      "In Instance-level MCP → Workflows exposed, choose Enable workflows, select the intended workflow and Enable. The account must have access. Search can reveal previews of other workflows visible to that account; exposure is not isolated per client. The assistant host must authorize each tool and its exact arguments.",
      "Use Reconnect for fresh consent. Disconnect here removes the local grant. Review and remove provider access separately in n8n's Instance-level MCP → Connected clients. Changing the Server URL requires discovery again; a new callback or client registration may also require fresh consent. Your application owns tokens and refresh outside the editor."
    ] },
    steps: [
      "LIMITATIONS: Automatic Vibe64 coding-chat attachment is deferred. A separately wired CLI or assistant host can discover and invoke exposed workflows through MCP after approving the exact tool and arguments; connecting alone does not attach chat tools. This connector is not the n8n REST API or a workflow designer.",
      "In n8n, open Settings → Instance-level MCP. An instance owner or admin selects Enable MCP access. This setup uses the personal-token method; n8n's OAuth tab is a different connection path.",
      "Under Connection details, select Connect → API key. On first opening, n8n generates a personal token for your account. Copy the Server URL and token now: after leaving, the token is redacted. Older versions call this tab Access Token. Do not use a REST API key or a workflow's MCP Server Trigger URL.",
      "Paste the full HTTPS Server URL ending /mcp-server/http here, keeping any installation subdirectory or port. Keep env:N8N_API_KEY as the token reference. Save configuration, then select Set credential in Env to store the token value. No OAuth app ID or callback is needed for this token method.",
      "Under Instance-level MCP → Workflows exposed, select Enable workflows, find the intended workflow and Enable. Alternatively open the workflow's top-right menu → Settings → Available in MCP. Check that the workflow is eligible and that the token owner has access. Search tools may reveal previews of other workflows this user can view; exposure is not isolated per client.",
      "Click Connect account after Env is configured. Verification initializes MCP and lists tools without running a workflow. The assistant host must approve each tool and its exact arguments; discovery alone does not establish permission to execute every workflow or attach tools to chat.",
      "To replace a lost token, return to Connection details → Connect → API key and generate a new token beside the redacted value. This revokes the old token: update Env for every client using it, then reconnect. Disconnect here removes local grants and does not revoke the n8n token."

    ]
  }
});

const sanityDefinition = Object.freeze({
  id: "sanity", name: "Sanity", description: "Discover and use Sanity's hosted MCP tools from an assistant.",
  accountModes: ["assistant"], authenticationMethods: ["oauth2", "api-key"],
  scopes: [{ value: "global", label: "Sanity MCP account access", recommended: true }],
  apiKeyReferenceLabel: "MCP API token reference",
  apiKeyReferenceHint: "Store a Sanity token in Env. Its role controls tool access at https://mcp.sanity.io; the assistant host must authorize individual calls.",
  setup: {
    url: "https://www.sanity.io/docs/ai/mcp-server",
    clientRegistrationEndpoint: "https://mcp.sanity.io/register",
    steps: [
      "Choose OAuth for Sanity account consent, or API key for a project-scoped token. This is builder/assistant context, not generated-app login. The editor coding-assistant attachment is deferred; saving alone does not make those tools available in chat.",
      "For OAuth, use the exact Suggested callback URL served by your backend. Click Register client and connect to create your client and save its credentials in development Env. For manual setup, POST the shown OAuth client registration JSON once to https://mcp.sanity.io/register, or use registerSanityClient from a CLI, then save client_id and the secret reference. Register only callbacks your backend serves.",
      "Save the client and callback references, set their values in Env, then connect and approve Sanity account access. The global scope is the provider's MCP scope, not a per-dataset permission selector. Authorize specific project, dataset and tool arguments in your assistant host.",
      "For API key authentication instead, select API key in Authentication. Open sanity.io/manage, select the intended project, then Settings, API, Tokens and Add new token.",
      "Give the token a distinct name, choose the smallest role the intended tools need and set an expiry if appropriate. Copy the token once shown.",
      "Store the token in Env and enter its reference here. The runtime uses Sanity's fixed HTTPS MCP endpoint.",
      "A project token cannot grant account-wide administration. Choose token ownership for the actual tools; successful discovery does not prove every tool is allowed.",
      "Save configuration. Connecting will check tool discovery; each tool call still needs the assistant's permission."
    ]
  }
});

export { n8nDefinition, sanityDefinition, validN8nOAuthDiscovery };
