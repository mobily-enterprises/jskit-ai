# Zoho Books

Import `zohoBooksProvider` from `@jskit-ai/connectors-catalog/server/zoho-books`.
This initial adapter discovers organisations and reads contact and invoice pages.
CLI and Vibe64 use the same configuration, OAuth service and encrypted file store.
Saving configuration does not connect an account.

## Register and configure

1. Open the [Zoho API Console](https://api-console.zoho.com/) in the data centre
   containing your account. Choose **Get Started** or **Add Client**.
2. Choose **Server-based Applications**, then **Create Now**. Enter **Client
   Name**, **Homepage URL** and the exact **Authorized Redirect URI** served by
   your backend. Choose **Create**. This adapter uses a backend-held secret;
   the Self Client flow is outside this implementation.
3. Open the client's **Client Secret** section. Copy its **Client ID** into
   the registration. Store its secret in `ZOHO_BOOKS_CLIENT_SECRET`, and the
   registered callback URL in `ZOHO_BOOKS_CALLBACK_URL`.
4. Select the matching **Data center** in Vibe64 or `settings.region` in JSON.
   For accounts in other regions, open the client's **Settings**, enable
   **Multi DC**, and enable each required region. Use that region's secret;
   do not assume all enabled regions share one secret.
5. To restrict this integration's resource operations to one organisation,
   open Zoho Books, click the organisation-name menu, then **Manage
   Organizations**. Copy its ID into **Organization ID (optional)**. Otherwise
   leave the field absent, discover organisations after consent, and have the
   application explicitly select an authorised ID for each resource request.
6. Keep **Read organisations and settings** enabled for connection verification.
   Contact and invoice reads are also selected initially. The ten optional
   full-access scopes preserve configuration choices for future operations;
   selecting them does not add write operations to this adapter.
7. Save configuration. The host calls `beginAuthorization`, opens the returned
   URL in the system browser, and handles `completeAuthorization` with the same
   authenticated owner. Zoho consent returns to the registered backend callback.
   The library verifies through `organizations.list` before saving the grant.

The [Books OAuth guide](https://www.zoho.com/books/api/v3/oauth/) documents client
registration, scopes, consent and Multi DC. Zoho's [server application guide](https://www.zoho.com/developer/oauth/web-server-apps/overview.html)
explains server clients and PKCE. [Organisation discovery](https://www.zoho.com/books/api/v3/organizations/)
and [organisation IDs](https://www.zoho.com/books/api/v3/introduction/#organization-id)
describe the Books-specific selection.

```json
{
  "schemaVersion": 1,
  "registrations": {
    "zoho": {
      "source": "own",
      "clientId": "1000.REPLACE_WITH_ASSIGNED_CLIENT_ID",
      "clientSecretRef": "env:ZOHO_BOOKS_CLIENT_SECRET",
      "callbackUrlRef": "env:ZOHO_BOOKS_CALLBACK_URL"
    }
  },
  "integrations": {
    "books": {
      "provider": "zoho-books",
      "displayName": "My accounting",
      "accountMode": "per-user",
      "authentication": { "method": "oauth2", "registrationRef": "zoho" },
      "settings": { "region": "eu", "organizationId": "10234695" },
      "scopes": [
        "ZohoBooks.settings.READ",
        "ZohoBooks.contacts.READ",
        "ZohoBooks.invoices.READ"
      ]
    }
  }
}
```

Remove `organizationId` to use discovery. IDs remain strings of digits. Client
secrets and callback URLs are resolved from references; no provider tokens or
raw secrets belong in this file. Client authentication defaults to
`client_secret_post`, with URL-encoded token parameters. The Books guide contains
query-string examples and conflicting wording about token parameters; this
adapter follows the shared Zoho server flow's form-body exchange, not JSON token
bodies. Real Books consent remains unverified in this fixture-only pass.
[Zoho token request parameters](https://www.zoho.com/crm/developer/docs/api/v8/access-refresh.html)

## Regional routing and account ownership

| Setting | Accounts host | API host |
| --- | --- | --- |
| `us` | `accounts.zoho.com` | `www.zohoapis.com` |
| `eu` | `accounts.zoho.eu` | `www.zohoapis.eu` |
| `in` | `accounts.zoho.in` | `www.zohoapis.in` |
| `au` | `accounts.zoho.com.au` | `www.zohoapis.com.au` |
| `jp` | `accounts.zoho.jp` | `www.zohoapis.jp` |
| `ca` | `accounts.zohocloud.ca` | `www.zohoapis.ca` |
| `cn` | `accounts.zoho.com.cn` | `www.zohoapis.com.cn` |
| `sa` | `accounts.zoho.sa` | `www.zohoapis.sa` |

All API operations use `/books/v3`. EU is the configuration default; choose the
account's actual location. Token `api_domain` must exactly match the selected API
origin. Neither a token response nor `accounts-server` in a callback can supply
an arbitrary destination. A mismatch requires correcting configuration and
reconnecting. Region and organisation configuration changes invalidate an
existing grant's configuration binding. [Books data centres](https://www.zoho.com/books/api/v3/introduction/#multiple-data-centers),
[Accounts data centres](https://help.zoho.com/portal/en/kb/accounts/manage-your-zoho-account/articles/data-center-for-zoho-account).

The host's `authorize` policy maps an authenticated caller to a stable
application and subject. Personal mode gives each app user a separate connection.
Shared mode deliberately maps authorised members to one shared subject; assistant
mode uses its owner's identity. For a trusted CLI, compose the same service,
registered callback listener, explicit reference resolver and durable file key.
Do not copy a permissive CLI owner policy into a public endpoint.

An optional configured organisation limits the adapter's resource destination;
it does not reduce Zoho's OAuth grant. Discovery still returns the connected
account's organisation metadata. The host must enforce any narrower organisation
policy, and Zoho enforces the connected user's access to resource requests.
A Books connection is not application login.

## Operations and failure behavior

| Operation | Input | Result |
| --- | --- | --- |
| `organizations.list` | None | Provider `organizations` array; verifies that a configured organisation is active and present |
| `contacts.list` | `organization_id`, `page`, `per_page` | Provider `contacts` and `page_context` |
| `invoices.list` | `organization_id`, `page`, `per_page` | Provider `invoices` and `page_context` |

For resource reads, omit `organization_id` only when configuration supplies it.
An input conflicting with the configured organisation fails before transport.
Without a configured ID, the app must choose explicitly from discovery; the
adapter never picks a first/default organisation. An empty discovery result is
valid when no organisation is configured. A configured missing or inactive
organisation prevents connection verification.

Each list makes one GET request. `page` defaults to 1 and accepts 1–1,000,000;
`per_page` defaults to 100 and accepts 1–200. These are initial library bounds.
The host uses `page_context.has_more_page` to request another page. Null data
fields and string identifiers are preserved. The documented invoice singleton
`page_context` array is normalised to one object, matching contact pagination;
an empty or multiple-entry pagination array fails. Arbitrary URLs, filters, mutations,
SQL and automatic traversal are excluded. [Contacts](https://www.zoho.com/books/api/v3/contacts/#list-contacts),
[invoices](https://www.zoho.com/books/api/v3/invoices/#list-invoices),
[pagination](https://www.zoho.com/books/api/v3/pagination/).

Only HTTP 200 with `code: 0`, the expected records and matching pagination is
accepted. Empty arrays are valid; HTTP 204, malformed JSON, nonzero success
codes and inconsistent paging fail. Provider error text is not returned.
HTTP 401 requires reconnect; 403, 404, 429 and server failures have separate
safe errors. Missing configured scopes fail before transport. The runtime does
not retry. Cancellation and timeout reach the provider request.
[Error responses](https://www.zoho.com/books/api/v3/errors/)

Refresh keeps the previous refresh token when no replacement is returned.
Zoho's `invalid_code` token error becomes a reconnect condition. Failed or
cancelled replacement consent preserves the saved grant; callback replay fails.
`disconnect` deletes local credentials. Provider-side revocation is separate:
open Zoho Accounts, **Connected Apps**, and revoke the application's access.
Avoid repeatedly starting consent as an error recovery loop; Zoho limits active
refresh tokens. [Token lifecycle and revocation](https://www.zoho.com/books/api/v3/oauth/)

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

Configure the required Multi DC settings on the application's own client and keep
regional secrets in its private Env. Preserve the selected region and Books
organisation with the connection. Separate client IDs do not guarantee separate
Books organisation capacity: rate limits and daily allowances are organisation-
based and plan-dependent.
[Books API limits](https://www.zoho.com/books/api/v3/introduction/#api-call-limit)

## Automation and verification

AI can write/validate this configuration, wire the existing library, implement
host callbacks and prepare regional setup values. Discovery itself is automated
through `organizations.list`. The reviewed provider documentation uses console
registration; a public API to create/configure these OAuth clients has not been
established. Account creation, sign-in, consent, regional enablement and any
provider review remain authorised operator/provider steps.

Local verification uses controlled HTTP responses and encrypted temporary files.
It does not connect real accounts, create provider clients, generate applications
or exercise accounting data. Deployed application callbacks, complete connection UI,
provider revocation, writes and the remaining Books APIs are separate unfinished
work. The initial adapter and its broader scope configuration do not imply full
API coverage.


## Existing-scope closeout — 13 September 2026

Supported: regional server OAuth, organisation discovery, configured or explicit
organisation selection, contact and invoice page reads, encrypted file grants
and refresh. Source 12/12 and installed-package 12/12 tests passed. Historical
editor form evidence is retained; no fresh browser run or runtime/form change.

Deferred work and limitations: no contact/invoice writes, customer payments,
credit notes, estimates, sales/purchase orders, bills, expenses, projects or
other Books resource operations. No record detail/search, attachments, webhooks,
automatic pagination, accounting calculations or processing of payments. Broader
scope choices do not enable these operations. No alternative OAuth grant types,
automatic client registration, region detection or provider-side revocation.
Organisation discovery does not prove contact/invoice permissions; an unconfigured
integration requires an explicit organisation per operation. The host must enforce
its own organisation/user policy in addition to provider permissions. Callback
routes, business/end-user connection UI and native framework wiring belong to the
application. Disconnect is local. Editor coding-agent attachment, live regional
consent/permissions/accounting outcomes and generated-app execution remain deferred
or unverified. The original broader accounting packet remains backlog.
