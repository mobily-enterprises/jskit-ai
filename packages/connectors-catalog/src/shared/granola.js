const granolaDefinition = Object.freeze({
  id: "granola", name: "Granola", description: "Read meeting notes with an API key or connect the assistant owner through Granola MCP OAuth.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key", "oauth2"], scopes: [
    { value: "openid", label: "Identify the connected Granola account", recommended: true, authenticationMethods: ["oauth2"] },
    { value: "profile", label: "Read account profile", recommended: true, authenticationMethods: ["oauth2"] },
    { value: "email", label: "Read account email", recommended: true, authenticationMethods: ["oauth2"] },
    { value: "offline_access", label: "Refresh access without repeating sign-in", recommended: true, authenticationMethods: ["oauth2"] }
  ],
  setup: { urlByAuthentication: { oauth2: "https://docs.granola.ai/help-center/sharing/integrations/mcp" }, clientRegistrationEndpoint: "https://mcp-auth.granola.ai/oauth2/register", url: "https://docs.granola.ai/help-center/sharing/integrations/granola-api", steps: [
"API key: In the Granola desktop app, open Settings, Connectors, API keys, then Create new key. Choose the note access scopes and Generate API Key.",
    "For an admin-owned workspace key, use Settings, Connectors, Workspace API keys, then Create new key. Both key types require a Business or Enterprise plan.",
    "Enter env:GRANOLA_API_KEY in API key reference and Save configuration. Choose Set credential in Env, paste the grn_ key as GRANOLA_API_KEY, and save there. Note permissions are chosen in Granola; editing this file grants no additional access.",
    "Shared mode deliberately shares the key's accessible notes. Assistant mode uses its owner's connection. For MCP tools, select OAuth instead; an API key cannot authenticate MCP.",
    "Return and choose Connect account. Your application verifies the key by listing accessible notes; an empty list is valid. Notes still being processed may be absent. No OAuth registration or callback is needed for API-key mode.",
    "For replacement, create a new key and update Env before retiring the old key. Disconnect removes local state. To revoke provider access, return to the personal or Workspace API keys page, select Revoke on that key and confirm."
  ], stepsByAuthentication: { oauth2: [
    "OAuth / MCP: Use a Granola account with meeting notes and select Assistant access. Free accounts can access personal notes from the last 30 days; some tools require a paid plan. Select OAuth and keep the account identity and refresh permissions selected.",
    "Confirm the Suggested callback URL is the exact route your application or assistant host will serve. Choose Register client and connect to create the client and save its credentials privately in development Env. CLI users can call registerGranolaClient; the manual endpoint/request remains available. Register once for this host, not once per connection.",
    "If registering manually, copy client_id into Client ID and Save configuration. Choose Set credential in Env for client_secret and Set callback in Env for the exact registered callback. Automatic registration saves these values for you; inspect Env before retrying an uncertain registration. Keep the response private.",
    "Return, save and choose Connect account. Sign into Granola in the browser and approve access. MCP verification lists tools without reading a meeting. Select the intended active workspace in Granola; MCP does not merge workspaces. The host must authorize tool calls before executing them.",
    "Disconnect removes the local OAuth grant. This does not promise provider-wide revocation. For help removing provider access, contact Granola at hey@granola.so. Changing your API key does not revoke an MCP OAuth connection."
  ] } }
});

export { granolaDefinition };
