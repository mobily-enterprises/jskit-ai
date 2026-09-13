# Sentry

Import `sentryProvider` and `registerSentryClient` from
`@jskit-ai/connectors-catalog/server/sentry`.

The connector uses Sentry's hosted MCP service for an explicitly composed
assistant. It does not configure SDK event ingestion, a DSN or application login.
Vibe64 coding-assistant attachment remains deferred. Saving this configuration
alone does not give editor chat access to Sentry.

## Configure access

1. Open the intended organization in Sentry. Copy its slug from the URL, then
   open Project Settings and copy the project slug if restricting to one project.
   Use slugs, not display names or numeric IDs. Organization selection is required;
   project selection is recommended.
2. Make the assistant host serve its own HTTPS OAuth callback. In Vibe64, enter
   it in **Suggested callback URL**, then choose **Register client and connect**.
   From a trusted backend or CLI instead, call `registerSentryClient` with `clientName`, `callbackUrl`
   and `scopes` (start with `org:read`). It registers at
   `https://mcp.sentry.dev/oauth/register`. Registration is an explicit action;
   inspect an uncertain result before retrying.
3. Store the returned client ID in the portable registration and the secret in
   private Env. Set the exact callback in Env too. Select OAuth and assistant
   ownership, with `settings.organizationSlug` and optional `settings.projectSlug`.
   This is registration with the MCP service, not a Sentry REST OAuth application.
4. Connect through the application's OAuth flow and review Sentry's consent.
   The configuration offers organization read and project/team/event write scopes.
   Sentry's granted MCP skills and account permissions also determine the tools
   available. A configured scope does not independently grant access.
5. Reconnect when access expires or the selected resource changes. Local
   disconnect removes the saved grant; provider-side permissions remain separate.

The same portable configuration is usable without the editor:

```json
{
  "schemaVersion": 1,
  "registrations": {
    "sentry-client": {
      "source": "own",
      "clientId": "REPLACE_WITH_REGISTERED_CLIENT_ID",
      "clientSecretRef": "env:SENTRY_CLIENT_SECRET",
      "callbackUrlRef": "env:SENTRY_CALLBACK_URL"
    }
  },
  "integrations": {
    "debugging": {
      "provider": "sentry",
      "accountMode": "assistant",
      "scopes": ["org:read"],
      "authentication": { "method": "oauth2", "registrationRef": "sentry-client" },
      "settings": { "organizationSlug": "your-org", "projectSlug": "your-project" }
    }
  }
}
```

Supply the actual client secret and callback through the application's Env.
Compose `createConnectionService` with this configuration, `sentryProvider`,
the application's encrypted store, reference resolver and authorization callback.
Use `beginAuthorization` and `completeAuthorization` for the browser round trip;
invoke `tools.list`/`tools.call` only under the owning application's authenticated
context. The CLI/operator also needs a backend capable of receiving the callback.

## Runtime and ownership

`tools.list` discovers available tool schemas, with an explicit optional cursor.
`tools.call` takes `name` and `arguments`; the host must authorize that exact
request before provider traffic. Do not hardcode tool availability from examples.
The selected resource is
`https://mcp.sentry.dev/mcp/{organizationSlug}[/{projectSlug}]` for both OAuth and
MCP requests. The provider constrains that resource; the application still owns
caller authorization and review of any triage or write operation.

The application owns tokens, encrypted persistence, callback execution and
refresh. CLI applications use the ordinary connection service without Vibe64.
Other frameworks consume the same configuration and Env names using their native
OAuth/MCP libraries, without importing JavaScript or running a Node sidecar.
The editor's subscription does not supply a Sentry account or quota.

## Pre-release configuration change

The previous Sentry REST fragment used `api-key` and `organizations.list`.
Replace that declaration with the MCP OAuth registration and assistant mode
above, set the intended organization/project, and connect again. A personal
Sentry token is not the MCP OAuth client secret. Replace REST operation calls
with explicit MCP discovery and authorized tool calls. No alias or automatic
conversion retains the old connection; remove its local record through its
owning application and review whether its old Env token is still used elsewhere.

## Verification and limitations

Two focused tests cover resource and registration validation. Seven OAuth/MCP
tests cover consent, PKCE, encrypted persistence, refresh, owner/resource
isolation, issue details, exact tool authorization, errors and cancellation;
those seven also pass through installed public package exports. Public editor
registration has a passing owner/Env test, and phone/desktop browser checks cover
registration, consent cancellation, reconnect, reload and disconnect. All use
controlled fixtures; live tool schemas, consent and account behavior are unverified.
The previous REST organization probe is replaced without a compatibility alias.

The official repository also documents a remote `Sentry-Bearer` token alternative,
distinct from OAuth `Bearer`. That alternative is not implemented here yet.

Sources: [hosted MCP instructions](https://mcp.sentry.dev/),
[official implementation](https://github.com/getsentry/sentry-mcp/blob/main/packages/mcp-cloudflare/src/server/index.ts),
[resource binding](https://github.com/getsentry/sentry-mcp/blob/main/packages/mcp-cloudflare/src/server/protected-resource-metadata.ts),
[OAuth metadata](https://github.com/getsentry/sentry-mcp/blob/main/packages/mcp-cloudflare/src/server/authorization-server-metadata.ts),
[scope definitions](https://github.com/getsentry/sentry-mcp/blob/main/packages/mcp-core/src/scopes.ts).
Public discovery requests returned HTTP 403 from the development environment;
source evidence does not establish successful live consent.
