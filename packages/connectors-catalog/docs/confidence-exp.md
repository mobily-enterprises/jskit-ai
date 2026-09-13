# Confidence Exp

Use `confidenceExpProvider` and `registerConfidenceClient` from
`@jskit-ai/connectors-catalog/server/confidence-exp`.
Read the [shared setup guide](confidence-oauth.md) for exact setup steps,
registration automation, ownership, quotas, callbacks and verification limits.

```json
{
  "schemaVersion": 1,
  "registrations": {
    "confidence-exp": {
      "source": "own",
      "clientId": "assigned-client-id",
      "clientSecretRef": "env:CONFIDENCE_EXP_CLIENT_SECRET",
      "callbackUrlRef": "env:CONFIDENCE_EXP_CALLBACK_URL"
    }
  },
  "integrations": {
    "experiments": {
      "provider": "confidence-exp",
      "accountMode": "assistant",
      "scopes": ["openid", "profile", "email", "offline_access"],
      "authentication": { "method": "oauth2", "registrationRef": "confidence-exp" }
    }
  }
}
```

The MCP destination is `https://mcp.confidence.dev/mcp/experiments`. Verification
uses `tools.list`. The provider describes `list_experiments`, `get_experiment`,
`get_results` and `get_resource`. Discover current schemas before invoking
`tools.call`; resource names must belong to the authorized request. Search and
list filters are different modes, and summary versus full detail changes the
returned information. See the
[MCP guide](https://confidence.spotify.com/docs/sdks/mcp-servers).

This initial adapter does not launch experiments, implement a statistics engine,
configure a warehouse or ingest events. Tool results are retained with their
error status; the application owns presentation and interpretation.
The application owns and registers its callback route, using its assigned public
URL as the initial origin. Keep that exact callback in application Env and update
the provider registration when it changes. Its grant stays separate from a
Confidence Flags integration.


## Read and interpret results

Call `tools.list` first and use each returned tool's current input schema. An
explicitly wired host can call `get_experiment` for an approved instance name,
then `get_results` for that same name (or a returned analysis name); Confidence
resolves the primary analysis when an instance is supplied. Request `summary:
false` only when full detail is needed. `get_resource` resolves referenced metric,
entity, surface, segment and fact-table definitions; authorize those IDs too.
`list_experiments` search mode ignores filter/orderBy, so do not assume it has
applied an access filter. Apply the host's resource authorization independently.

Use `connections.invoke({ context, integrationId: "experiments", operation:
"tools.call", input: { name: "get_results", arguments: { name:
approvedInstanceName, summary: false } } })` after connection. Preserve the MCP
result/error status and the provider's confidence intervals, significance,
sample sizes and status messages. A positive effect estimate is not automatically
a winning experiment. Do not fabricate a shipping recommendation or recalculate
provider statistics from a summary. Other frameworks can connect their native
MCP clients to the same endpoint with their own OAuth/grant storage.

**LIMITATIONS:** Vibe64 coding-assistant attachment is deferred. For example,
saving this connection does not make Vibe64 chat explain an A/B result; an
explicitly wired assistant host can retrieve it. Confidence owns statistical
analysis, metric/event ingestion and experiment execution. This adapter transports
its tools and results, not a new experimentation engine. Controlled fixtures
prove analysis content is preserved and other experiment IDs are denied; tool
schemas and actual statistical outputs remain provider-owned and were not
validated against a live account.
