const miroDefinition = Object.freeze({
  id: "miro", name: "Miro", description: "Use Miro board tools through the assistant owner's selected team.",
  accountModes: ["assistant"], authenticationMethods: ["oauth2"],
  scopes: [
    { value: "boards:read", label: "Read boards", recommended: true },
    { value: "boards:write", label: "Create and edit boards" },
    { value: "openid", label: "Include account identity" },
    { value: "email", label: "Read your email address" }
  ],
  setup: {
    url: "https://developers.miro.com/docs/connecting-to-miro-mcp",
    clientRegistrationEndpoint: "https://mcp.miro.com/register",
    steps: [
      "This is a Miro MCP assistant connection. Credentials from Miro's REST API Your apps screen cannot be substituted. Keep Assistant access and start with Read boards; select writes or identity access only when the host needs them.",
      "Enter the exact Suggested callback URL served by your application's backend. Open OAuth client registration below: copy the Registration endpoint and Registration request body into your HTTP client's POST request with Content-Type: application/json. The request includes the current callback and selected permissions. CLI/Node users can instead call registerMiroClient once with those same values.",
      "Send the registration request once. Copy client_id from the successful response into Client ID. Keep client_secret private and note any reported expiry. A timeout may still have created a client; investigate before retrying. This registers an MCP client and does not connect a Miro account.",
      "Keep env:MIRO_CLIENT_SECRET and env:MIRO_CALLBACK_URL as references. Save configuration, then use Set credential in Env for the returned secret and Open Env for the exact registered callback. Changing this form does not update an already registered client.",
      "Click Connect account, sign into Miro and select the team containing the boards you want. Review access and Continue back to your host. Reconnect and choose the correct team if board access fails. Team and organization policies still apply.",
      "Verification discovers available tools without executing them. The assistant host must authorize each tool and its exact board arguments before use. Discovery does not prove access to a particular board. Identity scopes do not configure app login, and this connection does not attach tools to chat automatically.",
      "LIMITATIONS: connecting does not attach Miro tools to Vibe64 coding chat. Example: an explicitly wired CLI/assistant host can read a board or request a diagram through discovered tools, but Vibe64 will not automatically see that board in your conversation. This shared attachment feature is deferred. No embedded board editor is provided.",
      "Reconnect to change teams or consent. Disconnect removes local grants; manage provider access separately in Miro. Keep registration secrets in Env and replace expiring credentials through the provider's supported setup before they expire."

    ]
  }
});

export { miroDefinition };
