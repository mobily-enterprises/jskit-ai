const confidenceScopes = [
  { value: "openid", label: "Identify the connected Confidence account", recommended: true },
  { value: "profile", label: "Read account profile", recommended: true },
  { value: "email", label: "Read account email", recommended: true },
  { value: "offline_access", label: "Refresh access without repeating sign-in", recommended: true }
];

function definition(id, name, description) {
  return Object.freeze({
    id, name, description, accountModes: ["assistant"], authenticationMethods: ["oauth2"], scopes: confidenceScopes,
    setup: { url: "https://confidence.spotify.com/docs/sdks/mcp-servers", clientRegistrationEndpoint: "https://mcp.confidence.dev/register", steps: [
      "Use a Confidence account with access to the intended organisation. This assistant connection uses browser OAuth, not a flag client secret or management API token.",
      "Confirm the suggested callback is the route your application will serve. Choose Register client and connect to create a project-owned client and save its ID, secret and callback through project Env. Existing Env values are preserved. Manual users can send the displayed registration JSON with Content-Type application/json; CLI users can call registerConfidenceClient.",
      "If registering manually, copy client_id into Client ID and store client_secret with Set credential in Env; use Set callback in Env for the exact registered callback. Automatic registration starts connection; after manual registration, choose Connect account. Sign into Confidence and approve the intended organisation. Your app must implement its callback and setup command.",
      "Verification only lists tools. The host must authorize each tool and its arguments; identity scopes do not limit calls to reads.",
      id === "confidence-flags"
        ? "Flag creation, variants, schema changes and targeting rules require explicit host approval of the exact change. Inspect the resulting flag and use testResolveFlag for the intended test entity. This configures management access, not production flag evaluation; wire the native Confidence/OpenFeature client separately."
        : "Retrieve experiment details and results through the host's approved tools. Preserve confidence intervals, sample sizes, significance and status messages: a positive effect estimate alone is not a winning experiment. Confidence performs the statistical analysis.",
      "Flags and experiments keep separate configured connections even though they share an OAuth service. Do not reuse a grant by changing its provider ID.",
      "If client_secret_expires_at is returned, plan replacement before expiry. A failed or interrupted registration is not proof that no client was created; investigate before retrying. Saving alone does not register a client or attach tools. Automatic Vibe64 coding-assistant attachment is deferred; an explicitly wired host can use these tools. Disconnect removes the local grant; it does not undo flag changes or revoke all provider access."
    ] }
  });
}

const confidenceFlagsDefinition = definition("confidence-flags", "Confidence Flags", "Manage Confidence flags through the assistant owner's MCP connection.");
const confidenceExpDefinition = definition("confidence-exp", "Confidence Exp", "Read Confidence experiments and results through the assistant owner's MCP connection.");

export { confidenceFlagsDefinition, confidenceExpDefinition };
