# Account connections

This package owns portable integration configuration, OAuth authorization and
refresh, connection state, and optional encrypted persistence. Application code owns
identity, permission decisions, HTTP routes, environment bindings and database
operation scripts. The same exports work in a server or an app-owned CLI.

The implementation supports **own OAuth registrations** (user consent and
provider-declared client credentials), provider-declared **service-account credentials**, **API-key connections**
and provider-declared **no-credential connections**.
Google Calendar supplies OAuth operations; Resend and Firecrawl supply API-key
operations through the connectors catalogue. Registrations use `source: "own"`.
Managed gateway registrations and their assignment fields are rejected during
configuration validation.

See [application-owned OAuth callbacks](docs/oauth-callbacks.md) for callback
routes, environment bindings and changes of domain or hosting.
The [application setup guide](docs/online-setup.md) explains credential and
runtime ownership for hosted editors and direct CLI use.

## Pre-release migration to application-owned connections

This is V0. The runtime accepts one current configuration format; it has no
legacy registration reader, gateway adapter or automatic grant conversion.
`schemaVersion: 1` identifies the current schema, not every historical draft
that used that number.

1. Back up the application's source and private runtime state before changing
   its configuration. Review each named integration's provider, account mode,
   permissions and settings against the current provider definition.
2. Replace managed registrations with the application's own provider
   registration. Remove `serviceUrlRef`, `serviceCredentialRef` and
   `assignmentRef`; changing only `source` to `own` cannot supply a real client.
   Set the actual client ID, required secret reference and callback reference.
   API-key integrations instead reference the application's own key.
3. Supply required secrets through the application's existing Env facilities.
   `MISSING` is an incomplete placeholder, not a working credential. Keep
   development and production bindings distinct. Register the exact app-owned
   callback URL with the provider before attempting OAuth consent.
4. Wire the current connection service into the application's authenticated
   routes and optional setup command. Use stable application/principal IDs and
   private persistent storage outside source or release directories. Retain the
   existing encryption key for records that the application already owns.
5. Reconnect when changing provider registration or moving away from a service
   that held the grants. Do not copy another service's tokens or infer that
   matching email addresses transfer consent or merge application users.
6. Validate with `validateIntegrationConfiguration(configuration, { providers })`,
   then verify connection, restart, cancellation and disconnect in the selected
   environment. A source-file migration alone does not establish a connection.

Retire obsolete service credentials deliberately after the replacement works.
Local disconnect removes the selected app connection; provider-side revocation
and cleanup of old services are separate operator actions.

## Configuration

Import `parseIntegrationConfiguration`, `validateIntegrationConfiguration` and
`integrationsSchema` from `@jskit-ai/connectors-core/shared/configuration`.
`integrationsSchema.getFieldDefinitions()` exposes the field definitions for
form inspection. Validate with `validateIntegrationConfiguration`, which also
checks references, credential combinations and provider scopes. Custom reference
validators do not currently provide transport JSON Schema export hooks.
References use a binding namespace such as `env:NAME` or `vault:path`;
literal HTTP/HTTPS URLs are rejected in reference fields.
Pass registered provider definitions in `{ providers }` for provider validation.
Scope entries may declare `required: true`; both CLI and UI validation reject
configurations missing any required permission. LinkedIn uses this for OpenID
and profile. Runtime operations still check the permissions actually granted.
Provider `settingsSchema` validates settings and supplies defaults in the returned
configuration. It can be a Schema instance or a synchronous function of the current
settings returning one. `getProviderSettingsSchema(provider, settings)` resolves
either form for CLI and UI consumers. Redshift uses this to require a workgroup
or cluster identifier according to deployment type and reject mixed fields.
Unknown providers fail by default; configuration editors can pass
`allowUnknownProviders: true` to preserve custom slots while validating known ones.
Errors expose `code`, `statusCode: 422` and dotted `fieldErrors` for shared forms.

`integrations.json` is application source. It contains named integration slots,
requested scopes, account modes and registration references. A registration
contains its public client ID and references to secrets and the **full callback
URL**, including its path. It never contains client secrets, authorization
codes, access tokens or refresh tokens. Unknown ordinary fields are rejected;
application-owned data belongs under `extensions` or provider `settings`.
Version changes require an explicit migration. Editing source does not transfer
an existing grant or request additional consent automatically.

Own registrations can specify `grantType: "client_credentials"`; omitted grant
types use `authorization_code`. Service accounts require a confidential client
and secret reference, forbid `callbackUrlRef`, and cannot use `per-user` ownership.
The provider must declare this flow in `oauthGrantTypes`. Its
`oauthClientAuthenticationMethods` can be an array or a synchronous function of
the grant type. `getProviderClientAuthenticationMethods(provider, grantType)`
resolves that contract for validation and forms. `getProviderScopes(provider,
settings, grantType)` similarly resolves `scopesForGrantType`, the existing
settings-dependent scopes, or the static scope list. Databricks uses both to
keep service credentials and user consent correctly configured.

Provider-specific service-account credentials use
`authentication: { method: "service-account", secretRef: "env:SERVICE_ACCOUNT" }`.
The reference resolves to a server-only credential string, including multiline
JSON when required by the provider. This mode requires selected permissions and
shared or assistant ownership. It does not use a registration, client ID,
callback URL or app-user identity. The provider validates its credential format;
the portable file retains only the reference.

## Runtime

Import `createConnectionService`, `createConnectorsFeature` and
`createEnvironmentReferenceResolver` from `@jskit-ai/connectors-core/server`.

```js
const connections = createConnectionService({
  configuration,
  providers: [googleCalendarProvider],
  store,
  resolveReference: createEnvironmentReferenceResolver(process.env),
  authorize: applicationConnectionPolicy
});
```

The required `authorize(context, { integrationId, operation, accountMode, input })`
returns `{ applicationId, subjectId }` from trusted application identity after
checking access. Return no owner to deny access. For a personal connection use
the authenticated app user's stable ID. For a shared account use a stable shared
subject only after checking membership and the requested operation. For
assistant access check the assistant's delegated permissions separately.
The environment resolver treats absent, blank and literal `MISSING` values as
incomplete bindings. Runtime credential checks also reject `MISSING` returned by
custom resolvers, and OAuth rejects a placeholder client ID before starting
consent. These failures report `connector_binding_missing`; they do not create a
verified connection or send the placeholder to the provider. Configuration may
retain placeholders while an administrator finishes setup.

Never trust owner IDs supplied by a browser. Include deployment/environment
identity in `applicationId` when several environments share storage.

For `invoke`, `input` is a separate copy of the caller's operation input. It is
omitted for connection-management methods. Check it when permission depends on
the requested tool, document or action. The service snapshots input before
awaiting policy, so neither caller nor policy mutation changes what executes.
For MCP `tools.call`, approve `input.name` and `input.arguments` explicitly;
membership alone must not grant arbitrary assistant tool execution.

Compose assistant-facing routes/tools with `executionMode: "assistant"`. This
is a trusted server/CLI composition choice, never an option from a request body.
The default `application` mode retains ordinary app authorization; `accountMode`
selects connection ownership and does not select the caller's execution mode.
In assistant mode, `assistantPolicy` on each integration supplies `enabled`,
`defaultPermission` (`ask`, `always`, `never`), and per-action `actions` overrides.
Omitted policy defaults to asking. Providers declare available override names in
`assistantActions`; the shared schema rejects unknown names and invalid values.
Keep this policy outside credential settings so edits do not require reconnection.

The existing `authorize` callback receives `assistantPermission: { action, decision }`
alongside the operation and copied input. For `ask`, the host must verify an
approval for that exact request and return `approved: true` with the authorized
owner. A missing approval raises `connector_approval_required` before provider
access. The host owns decision UI, persistence, expiry and replay prevention.
`always` still checks access; `never` or disabled access denies the action.
Workspace/organization rules remain in the host's authorization boundary and
cannot be overridden by the file. Do not trust a browser's `approved` flag.
Status, cancellation and local disconnect remain available through ordinary
access checks even when assistant actions are disabled. Pending OAuth completion
is still checked as a connect action; do not reuse an approval indiscriminately.

`authorizeAssistantAction({ context, integrationId, action, input })` checks a
declared host lifecycle action in assistant mode. It executes no provider operation
and creates no activation state. The host validates and performs its own operation
after authorization; use `invoke` for actual provider operations. This helper's
input is copied before authorization just like `invoke` input.

All methods take `{ context, integrationId }`:

| Method | Additional input | Result |
|---|---|---|
| `connectClientCredentials` | optional `verificationInput`, `signal` | Verified service account metadata; no browser consent |
| `connectServiceAccount` | optional `verificationInput`, `signal` | Provider-specific service credentials exchanged for a verified short-lived token |
| `beginAuthorization` | optional `verificationInput`, `signal` | Authorization URL, expiry and resolved callback URL |
| `completeAuthorization` | `callbackUrl`, optional `signal` | Verified connection metadata |
| `cancelAuthorization` | `state` | Cancelled attempt; existing connection preserved |
| `connectApiKey` | optional `verificationInput`, `signal` | API key verified through a provider read operation |
| `status` | — | Safe metadata or disconnected |
| `invoke` | named `operation`, `input`, optional `signal` | Provider operation result |
| `disconnect` | — | Local connection and pending attempts removed |

HTTP callback handlers must recover the same authenticated owner context as the
connect request. The runtime checks state, PKCE by default, exact callback destination,
registration identity, expiry and actual granted scopes. It verifies a provider
operation before reporting connected. Resource-specific providers (such as
Sheets) require a document ID in `verificationInput` when starting consent.
That input is validated before consent and retained in the owning attempt. Safe metadata excludes credentials.
Disconnect is local; it does not revoke the provider's entire shared grant.

A provider whose documented confidential flow excludes PKCE can set
`oauthPkce: false` (Workday). This cannot be used with a public client, and
pending attempts cannot switch between PKCE and non-PKCE flows. A provider with
no selectable scopes can use an empty scope list; authorization omits `scope`
in that case. Providers that offer permissions still require a selection.

Own registrations default to `tokenEndpointAuthMethod: "client_secret_post"`.
A provider can declare `"client_secret_basic"` in
`oauthClientAuthenticationMethods`; its own registration still requires a
secret reference. The OAuth library applies HTTP Basic client authentication
for both code exchange and refresh, without putting the secret in the body.
A provider may explicitly support `"none"` through
`oauthClientAuthenticationMethods`. Such registrations require Client ID and
callback references but forbid `clientSecretRef`; token grants use the OAuth
library's `None()` method and never resolve a client secret. Provider-owned
`validateClientId` checks specialized identifiers, such as Canva metadata URLs.
Authentication-type changes invalidate pending attempts and connected grants.
`clientIdLabel` and `clientIdHint` provide matching shared form copy. Providers
without an explicit methods list retain confidential-client authentication.

A provider can set `oauthClientIdParameter` when its documented wire protocol
uses a different field name. TikTok sets `client_key`; the portable file and
OAuth SDK client metadata still use `clientId` and `client_id`, respectively.
The runtime substitutes the wire field on authorization and token requests.
Provider `validateCallbackUrl(url)` can impose additional restrictions after the
shared URL checks; TikTok requires HTTPS and fewer than 512 characters.
These are provider-owned protocol rules, not arbitrary configuration overrides.

Providers that document granted scopes on the authorization callback can set
`scopesInAuthorizationResponse: true`. Their callback must contain exactly one
`scope` value. When the token response omits scopes, the service retains only
requested permissions present in that callback. Explicit token-response scopes
take precedence, and a permission required by the verification operation must
still be granted. Refresh preserves this reduced grant when scopes are omitted.

A provider with comma-separated OAuth permissions can set `scopeSeparator: ","`.
The default remains a space. Providers whose verification response describes
the grant can implement `grantedScopesFromVerification(result, { clientId })`.
It must return an array of scope strings and may reject a mismatched client.
The service retains only scopes present in the request, token/callback grant
and this verified array. Verification must still have its required permission;
otherwise the attempt fails without replacing an existing connection.
Initial OAuth grants are limited to configured permissions, even if a token
response contains additional scopes. For every OAuth provider, refresh retains
only scopes already granted and still
requested by configuration. It may reduce a grant but cannot expand it without
new consent, including providers without verification metadata.

API-key providers declare `apiKey.headers(key, settings)`, `apiKey.queryParameter`,
`apiKey.bodyParameter` or `apiKey.pathPrefix(key)` in their trusted runtime
definition. The service resolves the secret reference at request time. Query credentials are encoded and replace existing values only
after the operation destination passes its HTTPS/origin check. Body credentials
similarly replace their named JSON field in a new body object without mutating
operation input. They require an object body and reject GET/HEAD requests.
Path prefixes are supplied by trusted provider code after destination validation;
providers validate or encode the key as a path segment. The service changes only
the pathname and rejects ambiguous prefixes and dot segments. Neither operation
input nor configuration supplies a credential URL. Redirects are rejected.
Connection records contain the reference, not the key or authenticated URL,
and provider errors are reduced to safe connector errors. Application HTTP
instrumentation must redact authenticated URLs, credential headers and bodies.
Some read operations need input: PostHog flag verification requires an explicit
`distinct_id` in `verificationInput`. `connectApiKey` and the JSKIT
`verifyApiKey` action pass that input through the operation's ordinary validation.
It is not retained in connection records, and failed verification never creates
a connected record.
API keys are resolved on the server for each call. Connection storage retains
the reference, a private fingerprint of the last successfully used key and its
verified state. Key rotation does not copy a raw key into configuration or
connection records. Status reports `reconnect-required` when the Env key differs
from the verified key, without making a provider request. Successful explicit
verification or an authorized provider operation binds the replacement key. A
failed check leaves the last successful binding intact; a changed reference
requires verification again. The fingerprint is omitted from public status.

For pre-release installations with previously saved API-key connections, run
connection verification again. Records without a verified-key fingerprint report
`reconnect-required`; no table migration or compatibility adapter is required.
Do not populate the fingerprint from Env without performing verification.

A provider may set `apiKeySecretOptional: true` when an empty credential is a
documented mode, as with a ClickHouse database user's empty password. Omitting
`secretRef` then passes an empty string to its header function without resolving
a binding. An explicit reference still must resolve to a valid string; a missing
binding never falls back to no credentials. Providers without this flag retain
the required nonempty-secret contract.

`authenticationMethods: ["api-key", "none"]` declares a separate no-credential
mode. Its configuration is `{ method: "none" }` without either secret or
registration references. `connectWithoutCredentials({ context, integrationId,
verificationInput?, signal? })` performs the provider's check operation before
saving a grant, with no credential header or binding resolution. Authorization,
ownership, destination validation and file persistence still apply. Mode changes
invalidate old connections. This mode never substitutes for an application's
login or bypasses provider-side database permissions.
Provider `settingsFields[].authenticationMethods` restricts fields to particular
credential modes; the shared parser rejects values left in an incompatible mode.

Provider operations receive `(input, settings)` when constructing a request.
OAuth providers may supply `oauth(settings)` to select regional authorization
metadata. `oauthResource` may be a string or function of those settings; when
present, it is sent as `resource` in consent, code exchange and refresh. The
provider owns these fixed destinations, and existing settings comparisons
invalidate attempts/grants after a region change.
Providers that require the original callback when refreshing, such as Wave,
set `refreshRequiresRedirectUri: true`. The runtime saves that callback with
the grant and supplies `redirect_uri` during refresh. Changing the callback
binding then requires reconnection; configuration cannot redirect an existing
grant's refresh request to a new callback.
`oauthHeaders({ clientId })` can add a provider-required application header;
the runtime supplies the saved registration ID and retains ownership of the
Bearer header. `normalizeTokenResponse(response, { settings, grantType })` adapts
code-exchange and refresh replies before OAuth validation, for example Twitch's
scope arrays or Slack's nested user token. `grantType` is `authorization_code`
or `refresh_token`. `authorizationScopeParameter(settings)` selects the consent
permission parameter when a provider uses another name, such as Slack's
`user_scope`; the default is `scope`.
These are trusted server-provider hooks, not configuration or browser inputs.
Normalization must preserve validation and redact provider error bodies.
Shared definitions can expose `scopesForSettings(settings)` to select applicable
permissions from their catalogue. The parser rejects inapplicable selections;
the shared form uses the same function and removes incompatible selections when
settings change. Slack uses this for its user and bot permission sets.
Trusted operation request builders can return `headers` for protocol fields
such as Xero's tenant ID. The connection service adds its credential headers;
operation inputs must validate identifiers before constructing these headers.
These headers are provider code, never a free-form client configuration field.
Providers can supply `apiOrigins(settings)` for destinations derived from validated
application settings, such as Algolia's application ID. The runtime still checks
the exact origin before attaching credentials; it does not allow caller-supplied
URLs. Provider settings can reuse the exported `secretReference` field contract
from `connectors-core/shared/configuration` for additional credential references.
Verified connections and pending OAuth attempts retain the validated settings.
Changing settings, including region or sandbox/live environment, requires a new
verification and invalidates completion of consent begun with the old settings.

A trusted provider may supply `exchange(url, requestOptions, { fetchImpl, request, resolveReference, settings, apiKey })`
for a protocol such as MCP or AWS Signature Version 4. Operation validation, scopes, ownership and the
HTTPS/origin check run before this transport receives credential headers.
It receives the request body and bounded signal, and must enforce those
credentials' destination on every protocol request, reject redirects and
preserve cancellation. Ordinary providers retain the shared HTTP client.
This is a server-code hook, never an executable configuration field.
A provider may set `requestTimeoutMs` for its documented API timing needs;
ordinary requests and OAuth grants default to 15 seconds. Canva MCP uses
60 seconds for design operations. These are trusted provider constants.
`request` is the existing parsed-JSON HTTP client. `resolveReference` is the
same authorized application's binding resolver, allowing a provider such as
Inngest to resolve its separate Event Key without duplicating runtime ownership.
The provider must select credentials for each destination; Inngest never sends
its Signing Key to the Event API.

`createConnectorsFeature(options)` supplies the ordinary `connectors.core`
capability and `connectors.status`, `connectors.connect` and
`connectors.verifyClientCredentials`, `connectors.verifyServiceAccount`, `connectors.verifyApiKey`, `connectors.verifyWithoutCredentials` and
`connectors.disconnect` actions. Compose it with the application's action
runtime. Product-specific operations call the service from their own named
actions. The library does not expose an arbitrary authenticated URL proxy.

Client credentials use `oauth4webapi`'s client credentials exchange and the same
verification, authorization and storage lock as user connections. Expiry renews
with the resolved application secret; no refresh token is stored for this flow.
Renewal requests only the existing grant. Changing a service connection's
configured scopes or grant type requires explicit verification again, and a
changed grant type also invalidates browser attempts. A failed subsequent API
request still commits renewed tokens. `invalid_client` and `invalid_grant`
require reconnection. Trusted providers can set `tokenRefreshLeewayMs`; the
default is 30 seconds and Databricks uses 40 seconds. This is runtime metadata,
not an editable source setting.

For `service-account` mode, a trusted server provider implements
`serviceAccountGrant({ credential, settings, scopes, fetchImpl, signal, now })`.
`now` is the current timestamp in milliseconds. The provider owns credential
parsing and the provider's grant protocol, pins its token destination, rejects
redirects and honors the bounded signal. It returns `access_token`,
`token_type: "Bearer"`, a numeric `expires_in` between zero (exclusive) and
86,400 seconds, and optionally the granted `scope` string. Refresh tokens are
rejected. This is provider code, never executable configuration.

A provider's `checkOperation` may be an operation name or a function receiving
an authentication method and returning its verification operation name. An
operation can declare `authenticationMethods` to reject other credential methods
before transport. This supports providers whose REST API and MCP service have
different credentials and verification calls, without mixing their grants.

The connection service verifies the grant through `checkOperation`, enforces
both configured and granted permissions, and stores tokens through the existing
encrypted store. Each invocation resolves the credential reference; expiry or
a changed credential fingerprint obtains a replacement token under the same
connection lock. The credential itself is never saved. Renewal is committed
even if the following operation fails, and failed renewal never falls back to
an old token. Changing settings, the reference or requested scopes requires
verification again. This mode does not provide managed provisioning or browser
consent. The Firebase adapter supplies its provider-specific JWT bearer exchange;
the core and provider contracts are verified with controlled service-account fixtures.

## File storage

Import `createFileConnectionStore` and `createCredentialProtection` from
`@jskit-ai/connectors-core/server/file-storage`. This entry point does not import
or require database-runtime. Use `createFileConnectionStore({ directory,
protection })` with an absolute private directory outside application source.
Each connection uses an encrypted JSON record containing its grant and pending
authorization attempts. The same protection contract is described below.

The store locks each identity across processes, commits by replacing the whole
file, and preserves the previous record when a callback or write fails. It
prunes expired attempts when that connection is accessed. Different owners
cannot open copied records. Malformed files and symlinks fail without rewriting
them. Files default to mode 0600 and new directories to 0700; hosts can supply
`fileMode` and `directoryMode` to match an existing filesystem identity contract.
It does not change permissions recursively or fix an incorrectly provisioned
runtime directory. Back up both the private JSON state and its separate key.

Locks use `proper-lockfile` with a consistent 60-second stale interval and
heartbeat. All writers must use this store and must not manually remove live
locks. A process killed during a provider exchange can still need reconnection;
local file replacement cannot make a remote token rotation transactional.

## Storage and migrations

Import `createKnexConnectionStore` and `createCredentialProtection` from
`@jskit-ai/connectors-core/server/storage`. Use the application's existing Knex
client, with its selected JSKIT MySQL or PostgreSQL driver.

```js
const protection = createCredentialProtection({
  keys: { current: decoded32ByteSecretKey },
  activeKeyId: "current"
});
const store = createKnexConnectionStore({ knex, protection });
```

Keys come from server secret storage, separately from the database and source.
The protection wrapper uses the `jose` library's authenticated JWE encryption;
each encrypted record is bound to its owning connection. Keep previous named
keys while existing rows still use them. New writes use `activeKeyId`. Deleting
an old key before those rows are rewritten makes them unreadable. Applications
with an existing vault can instead provide compatible `seal(value, binding)`
and `open(ciphertext, binding)` methods.

Install `@jskit-ai/database-runtime` explicitly when using the Knex store. It is
an optional peer: editing portable configuration does not install or activate a
database provider. Applications using another store do not need this peer.

The package declares its authoritative migration directory in `package.json`.
Use the normal app-owned `knexfile.js` and migration scripts described by the
selected database package; do not copy these migrations or run them on startup
implicitly. Tables contain encrypted credentials/attempts and opaque identity
keys, with no dependency on a particular user table. Run
`store.pruneExpiredAttempts()` from the application's existing maintenance task.

A custom store implements `withConnection({ owner, integrationId }, work)`.
It must serialize the whole callback across processes for that identity and
commit on successful return. The callback receives `connection`, `save(value)`,
`remove()`, `putAttempt(attempt)`, `latestAttempt({ after })` and
`consumeAttempt(state)`. `latestAttempt` returns the current owner/slot's
latest-expiring attempt strictly after the supplied timestamp, or null, without
consuming it. Consumption must
affect only the current owner and slot. Removal also invalidates pending
attempts. Failures returned by the runtime are thrown after commit so failed
API requests do not roll back rotated refresh tokens or restore consumed codes.

## Current limits and proof

SQL locking spans bounded provider requests to serialize refresh, completion
and disconnect. Different connections use different locks. Database connection
pool sizing and process-crash recovery during provider token rotation need
deployment testing. A crash between provider rotation and a database commit
can still require reconnecting; there is no distributed atomic transaction
with Google.

Focused tests cover consent denial, replay, ownership, refresh, cancellation,
safe errors, configuration and Feature composition. The SQL test covers real
MariaDB persistence, independent pools, rollback, encryption and migrations.
File tests cover restart, interrupted callbacks, rejected writes, record binding,
symlinks, consent expiry and serialization across independent Node processes.
PostgreSQL and live Google consent are not yet verified. Gmail supplies a
verified mailbox display label; general account-selection screens and
provider-wide revocation remain separate work. Managed registrations are rejected.

The three new packages also install from local npm tarballs into a clean
standalone application. Its CLI validation, package migration discovery,
migration status, disconnected status and repeat migration run were exercised
against a disposable MariaDB database. These checks do not publish packages.

For application wiring see the Google Calendar package's `calendar-cli` pattern.

For direct API-key or credential-free connections, operation scopes constrain
the application configuration; they are not provider consent grants. Both
verification and invocation enforce those configured limits. `grantedScopes`
remains empty. OAuth connections additionally enforce the actual stored grant.
Trusted exchange implementations receive validated `settings` and the resolved
`apiKey` only for API-key mode, allowing an SDK to sign requests without placing
raw credentials into transport headers first. These inputs are server-only.


## Resuming application setup

`resumeAuthorization({ context, integrationId })` checks application connect
permission and returns the pending `{ authorizationUrl, expiresAt, callbackUrl }`, or null.
It uses the existing store and does not call the provider. Changing registration,
callback, scopes or settings invalidates the resumable result. Cancellation and
completion still consume the exact OAuth state once. A previous connected grant
remains independent of a new pending attempt.

For valid authorization-code bindings, `status()` also reports the resolved
`callbackUrl`. Applications can display this validated, public URL independently
of any editor suggestion; credentials and other Env values remain private.

Use [the application setup command guide](docs/setup-command.md) when connecting
an editor or CLI setup screen to this runtime. The app owns that executable and
its authenticated operator context; this library does not import an editor.


Status checks resolve required local bindings without a provider request. Before
a first connection, missing credentials or invalid callbacks return `unconfigured`
with `configurationError` set to `connector_binding_missing` or
`connector_callback_invalid`. For an existing matching connection they report
`reconnect-required` without deleting or changing the stored grant. Restoring the
binding can restore its previous status; status alone does not verify a new key.
Explicit disconnect remains available without working provider credentials.


Provider definitions may select `tokenRequestEncoding: "json"` when the token
endpoint requires JSON instead of OAuth's ordinary form encoding (Notion).
Only token grant requests use this encoding; API calls keep their existing
operation format. Authentication headers, redirect policy and abort signal
remain supplied by the OAuth library. `oauthBasicEncoding: "raw"` selects
base64 of the literal client ID/secret pair for providers documenting that
Basic convention; the default remains oauth4webapi's OAuth encoding. These
are provider implementation choices, not user-editable configuration fields.

Provider runtime implementations can declare `runtimeForSettings(settings)`
for materially different protocols under one catalogue entry (Notion REST/MCP).
The connection service resolves this trusted implementation after configuration
validation and before operations; settings never supply executable code.
`accountModesForSettings(settings)` constrains ownership choices in both
validation and forms. Client authentication metadata functions also receive
settings as their second argument. Existing providers keep their static behavior.

`dataFromTokenResponse(response, previousData)` lets a provider validate and
retain required account-specific routing from a processed token response
(Pipedrive's company API domain). Its return value is stored as private
`providerData` with the grant, including refreshes; it is omitted from public
connection status. Operation `request(input, settings, providerData)` and
`apiOrigins(settings, providerData)` receive this data. The provider must
validate destinations and account continuity before returning metadata. The
core still enforces HTTPS, allowed origins and rejection of URL credentials.
This metadata does not alter shared configuration or accept user-supplied
executable code; the file store seals it with the rest of the connection.

Scope metadata may include `authenticationMethods` when a permission belongs only
to particular credential modes. `getProviderScopes(provider, settings, grantType,
authenticationMethod)` filters these choices; configuration validation uses the
selected method. Forms remove incompatible scopes on method changes and select
recommended method-specific scopes when entering that mode. Granola uses this
to keep OAuth identity scopes out of API-key configuration.
