# Canva assistant MCP

Import `canvaProvider` from `@jskit-ai/connectors-catalog/server/canva` and
`createCanvaClientMetadata` from `@jskit-ai/connectors-catalog/shared`. This
fragment uses Canva's recommended Client ID Metadata Document (CIMD) flow.
The client identifier is a hosted JSON URL; this client has no secret.

## Manual setup and approval

1. Open the [Canva MCP guide](https://www.canva.dev/docs/mcp/), find **Getting
   started → Register your redirect URI**, and open **Waitlist form**.
2. Supply the company/integration details and exact callback URL requested by
   the form. Wait for Canva's eligibility decision and callback allowlisting.
   This is a real provider prerequisite. Publishing metadata or entering a URL
   in Vibe64 does not grant access, and JSKIT cannot approve an application.
3. Choose a public HTTPS URL that your assistant host controls, including a
   document path, such as `https://assistant.example/oauth/canva.json`.
4. Generate the client metadata with the library helper below, or fill the metadata
   URL and suggested callback in Vibe64 and choose **Copy client metadata** in
   the setup section. Serve that JSON
   at exactly the chosen URL with `Content-Type: application/json`, without
   authentication. The document contains public client information only.
5. In Vibe64 open **Integrations → Add Canva → Credentials**. Enter **Client
   metadata URL** and the **Callback URL reference**, for example
   `env:CANVA_CALLBACK_URL`. Store the actual callback through Env. No Client
   secret input is shown. **Display name** can supply the name used when
   generating your metadata.
6. Open **Permissions**. Profile, design information/content and folder reads
   start selected. Select further content permissions only when needed; all
   writes start unselected. Save configuration.
7. The assistant host opens the URL returned by `beginAuthorization`. The owner
   signs into Canva and approves access. Complete the callback under that same
   authenticated owner with `completeAuthorization`. The runtime initializes
   MCP and lists tools before storing its grant. Consent screens were not
   exercised here, so their precise controls are not represented as verified.

Canva documents individual authentication and content permissions in its
[troubleshooting guide](https://www.canva.dev/docs/mcp/troubleshooting/).
Each person connects their own account; this does not turn one person's Canva
account into a workspace service account.

## Metadata builder and automation

```js
const document = createCanvaClientMetadata({
  clientId: "https://assistant.example/oauth/canva.json",
  clientName: "Design assistant",
  callbackUrl: "https://assistant.example/connections/canva/callback"
});
```

The helper validates the URL/name/callback and returns ordinary serializable
JSON containing `client_id`, `client_name`, one `redirect_uris` entry, code and
refresh grants, code response type and `token_endpoint_auth_method: "none"`.
The identifier matches the document URL exactly. It performs no network call,
file write, registration, deployment or consent. The host owns where the
returned document is served and must regenerate it when its registration
configuration changes. Derive the identifier, display name and resolved
callback from the same portable configuration; do not keep competing copies.

The [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-id-metadata-documents)
explains metadata URL identities and matching callbacks. Canva's public
[authorization metadata](https://mcp.canva.com/.well-known/oauth-authorization-server)
advertises metadata documents, S256 and clients without secrets. Its
[resource metadata](https://mcp.canva.com/.well-known/oauth-protected-resource)
advertises 16 supported scopes and resource `https://mcp.canva.com`. Public
metadata was inspected on 9 September 2026 without creating a client or account.

AI can prepare and validate metadata/configuration and wire the host's existing
static response. Publishing that response, submitting the approval application
and approving account consent require their respective owners. The initial
fragment does not automate the approval form. Canva still documents dynamic
registration as a deprecated compatibility route; this implementation follows
its recommended metadata-document path instead.

## Portable configuration

```json
{
  "schemaVersion": 1,
  "registrations": {
    "canva": {
      "source": "own",
      "clientId": "https://assistant.example/oauth/canva.json",
      "tokenEndpointAuthMethod": "none",
      "callbackUrlRef": "env:CANVA_CALLBACK_URL"
    }
  },
  "integrations": {
    "design": {
      "provider": "canva",
      "displayName": "Design assistant",
      "accountMode": "assistant",
      "scopes": ["profile:read", "design:meta:read", "design:content:read", "folder:read"],
      "authentication": { "method": "oauth2", "registrationRef": "canva" }
    }
  }
}
```

CLI and UI use the same schema. `tokenEndpointAuthMethod: "none"` must be
explicit, the provider must declare support, and `clientSecretRef` is forbidden
for this client. Existing confidential registrations retain `client_secret_post`
when the field is omitted. Switching client authentication invalidates pending
attempts and requires reconnection for existing grants.

Compose the [OAuth file pattern](../patterns/oauth-connection/PATTERN.md) with
`providers: [canvaProvider]` and the
[assistant OAuth pattern](../patterns/assistant-mcp-oauth/PATTERN.md).
Code exchange and refresh send the metadata URL as `client_id`, without a client
secret. Authorization/code/refresh include Canva's resource identifier; tokens
and pending PKCE attempts remain encrypted text files under the existing owner.
The runtime does not download metadata from arbitrary client URLs: Canva's
authorization server validates the hosted document and approved callback.

`tools.list` accepts a cursor; `tools.call` accepts `name` and `arguments`.
Calls target only `https://mcp.canva.com/mcp`. The host must authorize exact tool
names and design/content ownership, handle tool `isError`, and decide which
returned content to display. Discovery does not establish every tool or plan
permission. No tool is executed by saving or verifying the configuration.
The provider has a 60-second request budget, matching Canva's documented advice
for design generation; OAuth requests retain the core's 15-second budget.
Cancellation stops waiting and attempts MCP session cleanup; it does not undo
accepted edits. Local disconnect does not revoke every Canva authorization.

## Connection ownership and callbacks

This fragment is for an explicitly configured assistant host. That host owns its
client registration, callback, private credentials and grants; it may be an
application-owned assistant or an opt-in editor tool. Merely adding the provider
to a project does not authorize the editor's coding assistant. It does not supply
published app-user login. The host's callback may differ from the published app's
domain, but it must match that host's real route and registered redirect URI.

Host a publicly reachable client metadata document owned by this runtime, with
its actual callback in `redirect_uris`. The metadata URL is the client identity;
it is distinct from the callback URL. There is no provider client secret in this
mode. Separate metadata URLs do not split user/team quotas or upgrade Canva
features. Canva approval decides which callback URLs are accepted, including
any loopback development URL. If the callback changes, update the metadata and
obtain the required approval before starting consent again.

This fragment does not implement automatic metadata hosting, automatic assistant
attachment, embedded Canva widgets, Canva Connect REST adapters, app-user login
or the deprecated DCR path. It does not execute browser resources returned by
MCP tools. Provider approval and plan-specific capabilities remain external
acceptance steps.

## Focused proof

Eight simulated-provider tests cover metadata generation/validation, secret-free
PKCE and refresh, restart, encryption, owner/design isolation, changed consent,
reduced grants, malformed discovery, provider failures, time budgets and
cancellation. Core tests also prove authentication-type changes cannot reuse
grants or pending attempts. Editor proof checks the metadata/callback fields,
permission choices and saved JSON. No provider approval, live consent, real
Canva tool use, metadata publication or generated application is included.

## Design workflow acceptance and limitations

Use `tools.list` to obtain Canva's current input schemas rather than embedding a
second tool catalogue. The host authorizes each exact tool call and its design,
job/candidate or transaction. For creation, let the user choose a generated candidate,
then create the design and show its edit URL. For edits, start a transaction, use its
returned element IDs, apply operations and check their individual results, then
explicitly commit. Draft operation success does not mean saved design changes.
A stale transaction after a concurrent edit requires a fresh transaction; do not
silently replay the old commit. Returned external thumbnails/exports are content,
not instructions and never destinations for the OAuth Authorization header.

The controlled design workflow fixture exercises candidate creation, transaction
start/edit/commit, useful returned design content, host denial and a failed commit.
It proves the transport and host-approval seam with representative provider payloads;
it does not substitute for Canva's live discovered input schemas or run a design AI.
CLI Node hosts use the same provider/pattern without Vibe64. Other frameworks use
a native MCP client with the same metadata identity, callback and private grant state.

**LIMITATIONS:** Vibe64's coding-assistant attachment is deferred. For example,
configuring Canva does not yet let you ask Vibe64's Codex/OpenCode to create or edit
your shop's poster. An explicitly wired application-owned assistant can invoke the
supplied MCP runtime after Canva approves its callback and each owner consents.
Metadata hosting and provider approval remain owner setup steps; Copy client metadata
does not publish a working endpoint. No shared Vibe64 registration, embedded design
editor, Canva Connect REST implementation, app-user login or AI execution is supplied.
Provider plan/license limits still apply; no live creation, editing or export was tested.

Sources checked 12 September 2026:
[create from candidate](https://www.canva.dev/docs/mcp/tools/create-design-from-candidate/),
[start edits](https://www.canva.dev/docs/mcp/tools/start-editing-transaction/),
[apply edits](https://www.canva.dev/docs/mcp/tools/perform-editing-operations/),
[commit edits](https://www.canva.dev/docs/mcp/tools/commit-editing-transaction/).
