# PostHog

Import `posthogProvider` from `@jskit-ai/connectors-catalog/server/posthog`.
This fragment implements the public project-token form, flag evaluation and
explicit event capture. Private analytics, OAuth, MCP, browser autocapture,
session replay and automatic event batching are not implemented here.

## Create and configure a project manually

1. Sign into the intended PostHog Cloud region. Open the project switcher in
   the top bar and select the analytics project, or use its create control.
   An organization's first project is created during setup; additional projects
   may depend on its plan. Choose an appropriate project name and complete the
   creation controls shown for your organization.
2. Open that project's settings from the switcher or sidebar. Copy its numeric
   **Project ID** and public **Project token** beginning with `phc_`.
3. In Vibe64, add PostHog. Set the display name, select **Region**, and paste the
   ID into **Project ID**. The form defaults to Europe; choose United States
   for a US project.
4. Store the token under `POSTHOG_PROJECT_TOKEN` in the application environment.
   Put `env:POSTHOG_PROJECT_TOKEN` in **Project token reference**, then save.
   CLI users write the same configuration below and resolve the same reference.
5. For rotation, regenerate the project token in PostHog settings, then update
   the environment binding. Regeneration invalidates the old token. Check all
   applications using it before rotating. Local connector disconnect only
   removes local connection state.

Projects own their data and token; they are distinct from organizations.
[Project settings](https://posthog.com/docs/settings/projects).

## Portable configuration

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "analytics": {
      "provider": "posthog",
      "displayName": "Product analytics",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:POSTHOG_PROJECT_TOKEN"
      },
      "settings": {
        "region": "eu",
        "projectId": "12345"
      }
    }
  }
}
```

Replace the example ID. The local schema accepts a positive decimal ID of up
to 20 characters and regions `eu` or `us`. This is a fragment validation limit,
not a claim about the maximum ID PostHog can issue. The token selects the
project for these operations. Saving the ID preserves the UI configuration,
but verification cannot establish that the separately saved ID matches the
token. The form explicitly explains this limit. Changing either setting
requires verification again.

This token is public and may deliberately be used by a frontend analytics
client. Keeping its reference in configuration is an ownership convention,
not a claim that it is secret. The adapter rejects personal (`phx_`), project
secret (`phs_`), and OAuth (`pha_`/`phr_`) credentials in this field. They belong
to different APIs. A public token cannot authenticate an application user or
read private analytics.
[API authentication](https://posthog.com/docs/api).

## JSKIT library and AI wiring

Use the [API-key composition pattern](../patterns/api-key-connection/PATTERN.md)
with this provider, a file connection store, environment-reference resolution,
and the application's authorization policy. Both configuration and runtime
state remain text files. The editor is not required by a CLI-built application.

```js
await connections.connectApiKey({
  context, integrationId: "analytics",
  verificationInput: { distinct_id: selectedUserId }
});
const result = await connections.invoke({
  context, integrationId: "analytics", operation: "flags.evaluate",
  input: {
    distinct_id: selectedUserId,
    groups: { company: selectedCompanyId },
    person_properties: { plan: "paid" }
  }
});
const checkoutVariant = result.flags.checkout?.variant;
```

The caller supplies `selectedUserId` and optional group identity from its own
authorized context. Verification requires a nonempty `distinct_id`; it never
creates a fake subject or sends an analytics event. The same input is accepted
by the JSKIT `verifyApiKey` action. It is not stored in connection state.
IDs have a local 200-character limit. `groups` and `person_properties` are
optional objects; the latter overrides properties for this evaluation.

`flags.evaluate` posts JSON to `/flags?v=2` on the chosen regional ingestor.
It preserves structured flag values, variants, reasons and metadata. Empty
flags are valid. HTTP-200 responses with a feature-flag quota limit or partial
evaluation error fail explicitly in this fragment. Applications must handle
those failures rather than assuming every missing flag is disabled.
[Flag evaluation](https://posthog.com/docs/api/flags).

The server request identifies itself as `jskit-connectors` and includes the
documented `posthog-node/` server-runtime marker. It does not load PostHog's SDK.
This avoids treating backend calls as an unidentified runtime when flags have
server-only targeting. The adapter supplies no browser origin or forwarding-IP
headers. It does not create flag-exposure events or implement a fallback cache;
the application owns those choices.

Event capture is a separate, explicit call:

```js
const accepted = await connections.invoke({
  context, integrationId: "analytics", operation: "events.capture",
  input: {
    event: "checkout_completed",
    distinct_id: selectedUserId,
    properties: { value: 19, currency: "EUR" }
  }
});
```

`events.capture` sends JSON to `/i/v0/e/`. It requires `event` and `distinct_id`,
with optional `properties`. The library supplies the configured `api_key` in
the body, after checking the exact origin. Callers cannot override the token,
destination or identity through reserved property fields. The fragment uses
one request per call and performs no retries, timestamp backfill or batching.
[Capture API](https://posthog.com/docs/api/capture).

A successful `status: "Ok"` indicates request acceptance, not final ingestion.
The returned `quota_limited` field is preserved for the caller to inspect.
An HTTP success must not be presented as proof that the event reached analytics.
The application also owns event consent, identity selection and location
attribution. This fragment does not forward a visitor IP; provider defaults
apply to requests made from the backend.
[API response semantics](https://posthog.com/docs/api).

## Automation feasibility and application ownership

An AI can write the configuration, environment names, file-store composition
and operation calls without accessing an account. Initial organization signup,
billing and authority to create projects still belong to the operator.

After an authorized private API credential exists, project creation can be
automated using `POST /api/organizations/{organization_id}/projects/` on the
regional private API host. Its documented scope is `project:write`; the request
accepts `name` and project settings, and the response includes the new ID and
`api_token`. Use distinct project names when separate analytics destinations
are intended. This provisioning API needs a private credential and is not
implemented by this public-token runtime.
[Project management API](https://posthog.com/docs/api/projects).

The application owner supplies its PostHog project and token. Separate
PostHog projects can provide different tokens and datasets. Two tokens
inside one organization do not establish independent budgets: flag quota limits
are organization-level. The application owns its usage accounting
and credential selection. Provider account/billing
arrangements determine actual capacity isolation.

An assistant that needs private analytics access requires a separate credential
flow. A future OAuth implementation can use PostHog's Client ID Metadata
Document registration model:

1. Prepare separate HTTPS metadata URLs under the operator's domain for public
   and online, if separate client identities are desired.
2. At each URL, serve JSON containing that URL as `client_id`, a `client_name`
   and an exact `redirect_uris` list; optionally add a logo. Publishing those
   documents requires control of the domain.
3. Use PostHog's authorization-server metadata and the metadata URL as client
   ID. PostHog retrieves the document; there is no mandatory dashboard
   preregistration. Scope selection and account consent are separate steps.
4. If organization verification is needed, open organization settings and
   **CIMD verification tokens**, then place the issued value under
   `com.posthog.verification_token` in the metadata. App verification is
   optional; its support path is documented separately by PostHog.

[OAuth and metadata registration](https://posthog.com/docs/api/oauth).
AI can prepare these documents and callback configuration, but these steps do
not enable OAuth in the implemented fragment. A separate OAuth implementation
must register the application's actual callback, bind consent to its authenticated
user and own its grants. That consent journey remains unfinished.

## Focused evidence

Nine tests exercise simulated PostHog responses with actual temporary encrypted
JSON files: both regions, restart, rotation, ownership, disconnect, settings,
explicit verification input, public-token validation, request boundaries,
flag results, capture acceptance, quota and HTTP errors. No live provider
account, consent, event submission or generated application is used.


## Existing-scope closeout — 13 September 2026

Supported: public Cloud project-token verification through explicit-subject flag
evaluation, `flags.evaluate` and `events.capture`, EU/US region configuration,
Env references, encrypted local connection state, token rotation and disconnect.
Nine controlled source tests and nine installed-package tests pass. Existing
phone/desktop configuration evidence is retained; no new browser run was made
for this closeout and no runtime/form behavior changed.

Limitations and deferred work:

- No private analytics querying, dashboards, project provisioning, personal API
  credentials, OAuth, MCP or self-hosted/custom ingestion domains.
- No browser SDK initialization, SPA navigation hooks/cleanup, autocapture,
  session replay, automatic identify/alias calls, automatic exposure events,
  batching, retries, timestamp backfill or offline cache.
- The application owns consent, subject/group identity, browser/server wiring,
  event deduplication and handling unavailable flags. A public project token
  neither authenticates users nor authorizes private data access.
- The token selects the destination project. The separately saved numeric
  project ID is not verified against it. A successful capture response means
  acceptance, not final ingestion; callers must inspect preserved quota fields.
- Flag quota or partial-evaluation failures are errors, with no automatic
  fallback value. The backend supplies no visitor IP forwarding.
- Disconnect removes local state only; rotate the token in PostHog when needed.
  Editor coding-agent tool attachment is deferred. No live token, tracking,
  ingestion, provider quota behavior or generated application was exercised.

The broader browser lifecycle/analytics backlog stays deferred under the user's
existing-capability milestone; this closeout does not claim full Lovable parity.
