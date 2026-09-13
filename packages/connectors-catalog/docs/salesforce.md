# Salesforce

Use `salesforceProvider` from `@jskit-ai/connectors-catalog/server/salesforce`.
This initial library connects an org through an own confidential OAuth web
registration, verifies API access and exposes object metadata and SOQL reads.
It uses Salesforce REST API v66.0. CLI and editor configuration share one schema;
the connection service handles consent, encrypted file state and refresh.

## Portable configuration

```json
{
  "schemaVersion": 1,
  "integrations": {
    "crm": {
      "provider": "salesforce",
      "displayName": "Customer CRM",
      "accountMode": "per-user",
      "scopes": ["api", "refresh_token"],
      "settings": {
        "environment": "production",
        "accountUrl": "https://acme.my.salesforce.com"
      },
      "authentication": { "method": "oauth2", "registrationRef": "salesforce" }
    }
  },
  "registrations": {
    "salesforce": {
      "source": "own",
      "clientId": "replace-with-consumer-key",
      "clientSecretRef": "env:SALESFORCE_CLIENT_SECRET",
      "callbackUrlRef": "env:SALESFORCE_CALLBACK_URL"
    }
  }
}
```

The client ID is public configuration. Resolve secret/callback references from
Env or the application's secret owner. Never paste a secret or an actual
callback URL into a reference field. File runtime state belongs outside source,
protected with a durable operator-owned encryption key. No editor database is
required. See the packaged `connectors/oauth-connection` AI pattern for the
shared server/CLI composition and its Salesforce example.

| Input | Stored value and behavior |
|---|---|
| Display name | Application-owned label, independent of the provider app name. |
| Account ownership | `shared`, `per-user` or `assistant`; the host authorizes the real stable subject. |
| Environment | `production` (default) or `sandbox`. Developer Edition uses Production. |
| Account URL | Lowercase HTTPS My Domain root. Production accepts `.my.salesforce.com` and `.develop.my.salesforce.com`; Sandbox requires `.sandbox.my.salesforce.com`. An optional trailing slash is preserved. |
| Client ID | Consumer Key issued to the External Client App. |
| Client secret reference | Indirect server secret; the runtime uses POST client authentication. |
| Callback reference | The exact registered backend callback, resolved at runtime. |
| Permissions | `api` for these operations; `refresh_token` for unattended renewal. |

Paths, query strings, userinfo, ports, generic login/test URLs, other hosts and
mismatched environments fail validation. Both OAuth endpoints and all API
requests use the configured My Domain. A token for a different `instance_url`
is rejected, rather than redirecting credentials to the returned destination.
Legacy instance hosts, Experience Cloud and sovereign domains are outside this
fragment. My Domain changes require updating configuration and reconnecting.

The `api` scope can authorize writes according to the Salesforce user's rights;
it is not a read-only scope. This adapter exposes reads only, and the application
must authorize the requested objects, fields and queries. `per-user` selects
individual connection ownership; it does not implement Salesforce login or
create an application session.

## Create and configure the provider app

Use an org whose edition and user permissions support API access. Current
Salesforce guidance restricts creation of old Connected Apps; use an External
Client App for a new integration. Existing registrations can continue subject
to their policies. [Salesforce's migration notice](https://help.salesforce.com/s/articleView?id=005228017&language=en_US&type=1).

1. Sign into the intended Salesforce org. Open the gear menu, then **Setup**.
   Enter **My Domain** in Quick Find and copy the current login URL. Use that
   root in Account URL; select the matching environment.
2. Search Setup for **External Client App Manager**. Select **New External
   Client App** (also available through App Manager in supported org UIs).
   Enter the app name, unique API name and contact email. Add a meaningful
   description. Keep distribution **Local** for an app used only by this org.
3. Enable the app's OAuth settings. Enter your backend's exact callback URL;
   preserve its scheme, host and path. Select **Manage user data via APIs
   (api)** and **Perform requests at any time (refresh_token, offline_access)**.
   This configuration requests the `refresh_token` spelling of that permission.
4. Keep **Require Proof Key for Code Exchange (PKCE)** enabled. Require the
   secret for **Web Server Flow** and **Refresh Token Flow**. The runtime
   implements confidential authorization-code exchange with S256 PKCE.
5. Save/create the app. Open its **Settings**, then **OAuth Settings** and
   **Consumer Key and Secret**. Complete any email verification Salesforce
   requires. Copy Consumer Key into Client ID; save Consumer Secret in the
   secret binding referenced by the configuration.
6. An org administrator reviews the app's **Policies**: permitted users,
   session/refresh lifetime, IP restrictions and refresh-token rotation.
   If admin preauthorization is required, grant the app to the intended users
   through their permission sets/profiles. Ensure those users have API access
   and only the object/field/record permissions the application needs.
7. Set the callback binding to the registered URL. Save `integrations.json`,
   then begin authorization from the application. Choose the intended Salesforce
   account and approve access. Verification reads limits; saving the editor form
   alone never completes consent.

The two responsibilities are separate: app developers control its settings;
subscriber administrators control their org's policies. A Local app is limited
to its own org. A distributable External Client App uses **Packaged** distribution
and a second-generation managed package, installed into each subscriber org.
[External Client App ownership and distribution](https://trailhead.salesforce.com/content/learn/modules/external-client-app-basics/use-external-client-apps-when-connected-apps-wont-do).

## Operations

| Operation | Input | Result |
|---|---|---|
| `limits.read` | `{}` | Current org allocations; also the connection check. |
| `objects.list` | `{}` | Available object summaries, including queryability. |
| `objects.describe` | `{ "object": "Account" }` | Fields and metadata for exactly that object API name. Custom names such as `ns__Widget__c` are supported. |
| `query.read` | `{ "q": "SELECT Id, Name FROM Account ORDER BY Id LIMIT 20" }` | One SOQL result page, preserving records, `totalSize`, `done` and any continuation. |
| `query.next` | `{ "nextRecordsUrl": "/services/data/v66.0/query/<locator>-2000" }` | One continuation page, with the same configured host and connection. |

Queries are single-line SELECT statements, at most 2,000 characters and 3,000
UTF-8 bytes. This fragment rejects `FOR UPDATE`, `FOR VIEW` and `FOR REFERENCE`;
it has no record write, MRU-update or explicit locking operation. The query
endpoint itself enforces SOQL syntax and user access. Never build SOQL by
concatenating untrusted request text. Use server-owned queries with deliberately
validated/escaped values and authorize the complete operation input.

Pages contain at most 2,000 top-level records. Subqueries can contain nested
records; the host must bound its query and overall rendering/workload. `done`
controls continuation, not the number of returned records. Only a relative
v66.0 Query cursor path is accepted; foreign URLs, other API resources, query
strings and path traversal fail before transport. Keep each cursor associated
with its originating query and owner in application state. There is no automatic
crawl. An expired locator returns `connector_cursor_expired`; start an authorized
query again. [Salesforce query and pagination behavior](https://developer.salesforce.com/blogs/2022/12/processing-large-amounts-of-data-with-apis-part-1-of-2).

## Token lifecycle and errors

Salesforce may omit access-token expiry because session lifetime is controlled
by org/app policy. For that response, this adapter schedules local renewal after
five minutes (the core refreshes shortly before that boundary). This is a renewal
policy, not a promise that the provider session lasts five minutes. An explicit
`expires_in` is honored. Renewal occurs on the next operation, not from a
background timer. Rotated refresh tokens persist under the existing file lock;
a response without a new refresh token retains the previous token. If none was
granted, renewal requires consent again.
[Web server flow](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm&language=en_US&type=5),
[refresh flow](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_refresh_token_flow.htm&language=en_US&type=5).

An invalid session or revoked refresh requires reconnecting; operations are not
automatically replayed. Failed replacement consent preserves a previous grant.
Org, registration or ownership changes cannot reuse an existing grant. A changed
secret binding is resolved on the next exchange. Scope reductions remain visible
and block operations without API permission. Disconnect removes the local
connection/attempts; revoke provider access separately in Salesforce when needed.

`REQUEST_LIMIT_EXCEEDED` is reported as an org rate limit even when Salesforce
returns HTTP 403. Other permission failures, invalid queries, missing resources,
expired cursors and reconnect states remain distinct. Provider error bodies are
not exposed as user messages. Cancellation/deadlines do not replay a request.

## Application ownership, callbacks and capacity

The application owner creates the provider registration and stores its secret
in the application's private Env. Public Vibe64, Vibe64 Online and CLI users use
this same ownership model. The configuration file holds the client ID and Env
references; the editor does not own the application's grants.

Register the exact callback implemented by the application. For a hosted project,
start with its assigned application URL and append the implemented callback path.
Save that same URL through the application's callback Env reference. On a domain
or host change, update both the provider registration and callback Env if the URL
changes. Preserve the application's identity and persistent grant store when
moving it; neither a new editor URL nor a new hosting address creates a new owner.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md) and
[application setup command](../../connectors-core/docs/setup-command.md).

For cross-customer org access, package and install the application as described
above; creating a Local app does not make it universally available. The app owns
its distribution, secrets and policy decisions, with each Salesforce org granting
its required access.

Separate client IDs do not divide an org's Daily API Request allowance. Apps
using the same org share that capacity; no registration name grants extra quota.
[Salesforce API allocation ownership](https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage).

## Automation feasibility and verification

An AI with authorized Salesforce developer/admin tooling can prepare External
Client App metadata and deploy it through Salesforce CLI/Metadata API. The
provider's documented types include `ExternalClientApplication`,
`ExtlClntAppGlobalOauthSettings` and `ExtlClntAppOauthSettings`. Their settings
cover distribution, callbacks and scopes; sensitive OAuth settings have separate
handling. Use an already authorized org and the exact supported metadata version.
[Salesforce's metadata/CLI walkthrough](https://trailhead.salesforce.com/content/learn/projects/create-an-external-client-app-using-metadata-api/create-an-external-client-app).

The operator still owns account creation, authorization, sensitive consumer-detail
access, subscriber installation and policies. No unattended signup, approval or
secret retrieval is promised. Prepare and review the application's metadata
before an authorized deployment; this adapter performs none of those provisioning
writes. It does not bypass the restrictions on old Connected App creation.

Automated evidence uses controlled HTTP responses, actual encrypted temporary
files and the editor form. It covers both environments, PKCE, renewal/rotation,
owner/org binding, query/cursor limits, malformed replies, cancellation and
save/reload. Live org access, real consent, queries against
customer data and application generation are outside this delivery's tests.
Writes, Bulk API, SOAP, streaming, MCP, client-credentials/JWT grants, identity
login and additional domains remain outside the initial runtime fragment.


## Existing-scope closeout — 13 September 2026

Supported operations are `limits.read`, `objects.list`, `objects.describe`,
`query.read` and `query.next`, through project-owned confidential OAuth on the
configured production/developer/sandbox My Domain. Source and offline installed
public-export tests each pass 13/13, including the packaged configuration example.
Historical editor form proof is retained; no new browser run or runtime/form
change was needed for this closeout.

Deferred work and limitations: record create/update/delete and relationship
mutations, bulk/partial-write handling, SOAP, streaming/events, MCP, automatic
pagination, query building/parameter binding, client-credentials/JWT or other
grants, identity login, Experience Cloud/sovereign/legacy instance hosts and API
versions other than v66.0. Queries are bounded single-line SELECT inputs, not an
unrestricted query console; host policy must authorize objects, fields and query
text. The adapter rejects FOR UPDATE/VIEW/REFERENCE effects. It does not provision
orgs/apps, assign permissions or bypass API capacity. API-limit verification alone
does not establish access to a particular object or field. A missing token expiry
uses a five-minute local renewal policy, not a provider lifetime guarantee.
Disconnect removes local grants only; provider revocation remains an org/admin
action. Native framework routes, business UI, app sessions and access policy are
application-owned. Editor coding-agent attachment, live org/consent/data outcomes
and generated-app execution remain deferred or unverified. The original broader
CRM checklist stays backlog; this is not full Lovable parity.
