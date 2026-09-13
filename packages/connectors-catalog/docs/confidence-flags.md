# Confidence Flags

Use `confidenceFlagsProvider` and `registerConfidenceClient` from
`@jskit-ai/connectors-catalog/server/confidence-flags`.
Read the [shared setup guide](confidence-oauth.md) for exact setup steps,
registration automation, ownership, quotas, callbacks and verification limits.

```json
{
  "schemaVersion": 1,
  "registrations": {
    "confidence-flags": {
      "source": "own",
      "clientId": "assigned-client-id",
      "clientSecretRef": "env:CONFIDENCE_FLAGS_CLIENT_SECRET",
      "callbackUrlRef": "env:CONFIDENCE_FLAGS_CALLBACK_URL"
    }
  },
  "integrations": {
    "flags": {
      "provider": "confidence-flags",
      "accountMode": "assistant",
      "scopes": ["openid", "profile", "email", "offline_access"],
      "authentication": { "method": "oauth2", "registrationRef": "confidence-flags" }
    }
  }
}
```

The MCP destination is `https://mcp.confidence.dev/mcp/flags`. Verification uses
`tools.list`, without calling a flag tool. Discover schemas before invoking
`tools.call`; the host can allow listing/reading while separately approving
creation or targeting changes. Account identity scopes do not enforce that
distinction. The provider describes tools including `listFlags`, `getFlag`,
`createFlag` and `testResolveFlag` in its
[MCP guide](https://confidence.spotify.com/docs/sdks/mcp-servers).

This initial adapter does not implement an OpenFeature evaluation provider,
production resolve/apply calls, event collection or a management API client.
The application owns and registers its callback route, using its assigned public
URL as the initial origin. Keep that exact callback in application Env and update
the provider registration when it changes. The builder's assistant grant must
not become a shared app-user grant.


## Managing flags with deliberate approval

Discover current schemas using `tools.list`; do not hardcode argument names from
examples. The documented tools cover `listClients`, `listFlags`, `getFlag`,
`createFlag`, `addFlagVariant`, `updateFlagSchema`, `createOverrideRule`,
`testResolveFlag` and `analyzeFlagUsage`. Use `tools.call` with the discovered
name/schema and an authenticated host policy that approves the exact operation,
flag, variant, targeting rule and context. An identity OAuth scope is not write
approval. Review the proposed change before executing it, then read/test the
result. A test-user override is not a rollout to all users.

For example, an explicitly wired assistant can create a boolean checkout flag,
add an enabled variant, target only a test account, and call `testResolveFlag` to
inspect the selected variant and explanation. Preserve tool `isError` even on
HTTP success. If a write times out, inspect the flag/rules before retrying; neither
local cancellation nor disconnect undoes a remotely applied change.

The host owns its OAuth registration, callback and private Env references. A CLI
can use the same JSKIT methods without Vibe64, or another framework's native MCP
client with the same endpoint and its own OAuth storage. Production flag evaluation
belongs to that framework's Confidence/OpenFeature integration; never place this
management grant in a browser or treat it as the application's client secret.

**LIMITATIONS:** Automatic Vibe64 coding-assistant attachment is deferred. Saving
this connection does not let Vibe64 chat switch a feature on; an explicitly wired
host can approve and call these management tools. This is not a feature-flag
execution engine, event pipeline or visual rollout dashboard. The generated app
must separately implement runtime evaluation if it wants to hide/show features.
Controlled fixtures prove transport, exact write approval, tool-error retention
and no replay; their example argument shapes are not live schema verification.
