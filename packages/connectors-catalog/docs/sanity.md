# Sanity assistant MCP connection

Import `sanityProvider` from `@jskit-ai/connectors-catalog/server/sanity`.
Configure `accountMode: "assistant"`. OAuth uses a project-owned MCP client,
`global` scope and callback/secret Env references. API-key mode instead uses a
Sanity token reference. Transport remains fixed at `https://mcp.sanity.io/`;
this is builder context, not a generated-app login or REST content service.

## OAuth registration and consent

Sanity's public metadata advertises issuer `https://mcp.sanity.io`, resource
`https://mcp.sanity.io` (no trailing slash), `/authorize`, `/token`, `/register`,
S256 and the single `global` scope. Keep the resource value exact even though
MCP transport uses the root URL. Metadata was read without authentication;
no client or provider account was created during implementation.

In Vibe64 development settings, choose **Register client and connect** after
setting the suggested callback. The existing owner-authorized action saves the
client ID in configuration, saves secret/callback/recovery ID in Env and starts
the application's setup command. It refuses occupied Env keys and stale source.
An uncertain outcome requires inspection before retrying. This does not register
a central Vibe64 client.

For manual setup, use the OAuth client registration screen's JSON, or invoke
`registerSanityClient({ clientName, callbackUrl, scopes: ["global"] })` from
`@jskit-ai/connectors-catalog/server/sanity` in an authorized CLI. Register once,
then save the returned client ID and private client secret into your own
configuration/Env. Investigate an interrupted request before retrying, because
the provider may already have created the client. Use the exact backend callback
suggested by your project. No central Vibe64 callback or managed registration.

Connect and consent only after the backend serves that callback. Sanity account
permissions govern the grant; the host must still authorize project/dataset
arguments and tools. The single global scope is not a per-project permission UI.
The token mode below remains an alternative.

## Manual setup

1. Sign in to **sanity.io/manage** and select the project.
2. Open **Settings → API → Tokens → Add new token** with an appropriate admin
   role. Set a descriptive name, the required role and optional expiry.
3. Copy the token once displayed. Store it in Env and enter its reference in
   the integration's **MCP API token reference** field.
4. Save configuration and verify MCP discovery before approving tool calls.

Sanity documents both [token creation](https://www.sanity.io/docs/content-lake/http-auth)
and [MCP bearer authentication](https://www.sanity.io/docs/ai/mcp-server).
A project token has project authority; personal and organization tokens have
different reach. Choose the credential for the actual tools required, and
avoid distributing a personal account's broad token to an application.

## Runtime and assistant policy

The runtime shares the core's authorization, secret resolution and encrypted
text storage. It verifies initialization and `tools.list`, not every tool's
permission. `tools.list` accepts an opaque optional cursor. `tools.call` requires
the advertised tool `name` and an `arguments` object. The assistant host must
authorize both values through its existing delegated-access policy before the
call. It must also validate arguments against the chosen tool contract and
handle untrusted tool descriptions and results as external data.

Sanity tools may modify content or administer resources. Selecting this
connector does not grant permission for such actions. The host decides which
tools are available and when user approval is needed. No automatic SDK resource,
prompt, elicitation or sampling capabilities are enabled here.

JSON and SSE responses use the official MCP client. Each operation initializes
a temporary session, carries credentials only to the fixed endpoint, attempts
session deletion, and closes local streams. The 15-second request bound and
cancellation do not roll back remote changes. Tool `isError` results remain
visible to the caller; failed protocol exchanges are sanitized. An HTTP 401
requires reconnecting. Token rotation resolves the current Env value on each
call without putting it into source.

## Useful context and native framework wiring

An explicitly wired assistant host first calls `tools.list` and inspects the
returned input schemas. Choose the authorized project and dataset in tool inputs;
these are not global editor credentials or application login settings. For schema
context, use `get_schema`; when multiple deployed schemas exist, use
`list_workspace_schemas` to select the intended schema. For content, use
`query_documents` with a bounded GROQ projection and slice. Treat tool availability
and argument schemas as provider-owned discovery, not a permanently copied list.

The JSKIT host invokes `service.invoke({ context, integrationId,
operation: "tools.call", input: { name, arguments } })`. Its authorization callback
must approve the exact project, dataset and arguments before execution. A proposed
content write needs that same review, not merely permission to list tools. Keep
results as data; do not execute instructions embedded in content.

A non-JavaScript host uses its framework's MCP client, OAuth implementation and
private token store with the same fixed endpoint and Env references. It does not
run JSKIT or call an editor server for content. The generated application can use
its own Sanity SDK for runtime content; this builder-context connection does not
automatically become a public site's credential. CLI composition uses the same
configuration and runtime API without Vibe64. Neither path automatically attaches
these tools to Vibe64's coding assistant.

## Automation and application ownership

After authorized login, AI can use the documented
[Sanity tokens CLI](https://www.sanity.io/docs/cli-reference/tokens) to manage
tokens. Sanity's [Access API](https://www.sanity.io/docs/content-lake/http-auth)
also supports robot-token creation with permissions. Our fragment does not
perform provisioning or request account administration automatically.

The API-token mode has no OAuth client ID. The application owner supplies its project
token through private Env. Separate tokens on one project do not promise separate
provider quotas or billing. Confirm the project/organization limits for the
application's usage. OAuth uses the same MCP transport with a separately issued user grant.

## Proof and limits

The shared MCP suite exercises the real SDK with local response fixtures and
real encrypted files: JSON/SSE, protocol negotiation, discovery/calls, scoped
owner policy, restart, token rotation, failures and cancellation. OAuth fixtures additionally cover issuer/resource/PKCE binding, restart/refresh,
registration failure, schema and bounded content retrieval, denied dataset/query
changes and disconnection cleanup. Tool payloads/results are controlled fixtures;
this does not certify current live Sanity schemas. Editor proof covers token
reference validation/reload and OAuth registration, cancellation, reconnect and
disconnect on phone and desktop. Live Sanity access, real OAuth consent,
automatic assistant attachment and generated applications are not exercised.
