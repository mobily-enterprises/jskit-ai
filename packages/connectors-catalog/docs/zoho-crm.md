# Zoho CRM

Import `zohoCrmProvider` from `@jskit-ai/connectors-catalog/server/zoho-crm`.
The initial adapter reads the current CRM user and pages of leads, contacts,
accounts and deals. It uses the existing OAuth connection service and encrypted
file store. Vibe64 and CLI users edit the same `integrations.json`; saving that
file does not perform consent or verify credentials.

## Register a client

1. Sign into the [Zoho API Console](https://api-console.zoho.com/) with the account
   that will own the registration. Choose **Get Started**, or add a client if
   your console already contains registrations.
2. Select **Server-based Applications**, then **Create Now**. This adapter uses
   a backend-held secret. Enter **Client Name**, **Homepage URL**, and the exact
   **Authorized Redirect URI** served by your backend. Choose **Create**.
3. Open **Client Secret**. Copy **Client ID** into the registration below.
   Store **Client Secret** in the runtime binding `ZOHO_CRM_CLIENT_SECRET`.
   Store the registered redirect URI in `ZOHO_CRM_CALLBACK_URL`.
4. In the configuration, select the data centre containing the CRM account and
   the intended Production, Sandbox or Developer environment. During consent,
   choose the matching organisation and environment. A token belongs to that
   choice and cannot be reused for another CRM environment.
5. For accounts in additional data centres, open the client's **Settings** and
   enable **Multi DC** for each required location. Client secrets can differ by
   data centre; assign the appropriate secret reference to each registration.
   Confirm the target region is enabled before starting consent.
6. Save configuration, call `beginAuthorization`, and open its URL in the system
   browser. Complete consent through `completeAuthorization` with the same
   authenticated owner. Verification calls `users.current`. The library requests
   offline access, consent and PKCE; the host supplies the callback handler.

[Registration fields](https://www.zoho.com/crm/developer/docs/api/v8/register-client.html),
[organisation consent](https://www.zoho.com/crm/developer/docs/api/v8/auth-request.html),
[Multi DC settings](https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html),
[server apps and PKCE](https://www.zoho.com/developer/oauth/web-server-apps/overview.html).

```json
{
  "schemaVersion": 1,
  "registrations": {
    "zoho": {
      "source": "own",
      "clientId": "1000.REPLACE_WITH_ASSIGNED_CLIENT_ID",
      "clientSecretRef": "env:ZOHO_CRM_CLIENT_SECRET",
      "callbackUrlRef": "env:ZOHO_CRM_CALLBACK_URL"
    }
  },
  "integrations": {
    "crm": {
      "provider": "zoho-crm",
      "displayName": "Personal CRM",
      "accountMode": "per-user",
      "authentication": { "method": "oauth2", "registrationRef": "zoho" },
      "settings": { "region": "eu", "environment": "production" },
      "scopes": [
        "ZohoCRM.users.READ",
        "ZohoCRM.modules.leads.READ",
        "ZohoCRM.modules.contacts.READ",
        "ZohoCRM.modules.accounts.READ",
        "ZohoCRM.modules.deals.READ"
      ]
    }
  }
}
```

Client authentication defaults to `client_secret_post`. The form offers twelve
permission choices; five read scopes are selected initially. Full-access scopes
are optional and do not add write operations to this adapter. Scope names are
case-sensitive and are sent comma-separated. [Scopes](https://www.zoho.com/crm/developer/docs/api/v8/scopes.html)

## Routing and ownership

| Region | Accounts host | Production API host |
| --- | --- | --- |
| `us` | `accounts.zoho.com` | `www.zohoapis.com` |
| `eu` | `accounts.zoho.eu` | `www.zohoapis.eu` |
| `in` | `accounts.zoho.in` | `www.zohoapis.in` |
| `au` | `accounts.zoho.com.au` | `www.zohoapis.com.au` |
| `jp` | `accounts.zoho.jp` | `www.zohoapis.jp` |
| `ca` | `accounts.zohocloud.ca` | `www.zohoapis.ca` |
| `cn` | `accounts.zoho.com.cn` | `www.zohoapis.com.cn` |

Sandbox and Developer replace `www` with `sandbox` and `developer`. Every token
response must contain the exact configured API origin. A different or missing
`api_domain` fails before an API request. The runtime does not follow arbitrary
`accounts-server` callback values or switch regions automatically; reconnect with
the correct regional configuration and client secret. Changing region or environment
invalidates the old connection. Additional provider regions remain outside this
initial adapter. [Token domains and environments](https://www.zoho.com/crm/developer/docs/api/v8/access-refresh.html)

The host's `authorize` policy maps an authenticated app user to a stable
application/subject pair. `shared` deliberately maps authorized members to one
shared subject; `assistant` uses the assistant owner's subject. The integration
file never establishes membership or app login. For a CLI, use a trusted process
owner, the same library, a registered callback listener, and explicit reference
resolution. A public desktop editor must not distribute a commercial client secret.

## Operations and failure behavior

| Operation | Inputs | Result |
| --- | --- | --- |
| `users.current` | None | Exactly one current CRM user, in the provider's `users` envelope |
| `leads.list` | Paging and fields | `data` and `info`; default fields `Last_Name,Email` |
| `contacts.list` | Paging and fields | `data` and `info`; default fields `Last_Name,Email` |
| `accounts.list` | Paging and fields | `data` and `info`; default field `Account_Name` |
| `deals.list` | Paging and fields | `data` and `info`; default fields `Deal_Name,Stage` |

Paging accepts `per_page` 1–200 (default100), `page` 1–10 (default1), or a
`page_token`, never both page selectors. `fields` accepts up to50 distinct,
comma-separated ordinary field API names. The adapter excludes special `$` fields.
IDs remain strings. No arbitrary module, query, destination or write is accepted.

The adapter makes one request per page and preserves cursor metadata and null
field values. Use a returned cursor with the same user and query parameters;
the provider limits cursor lifetime and total traversal. HTTP204 becomes an empty
record page, while malformed HTTP200 responses fail. The application owns record
selection, display, continued paging and policy. [Records and paging](https://www.zoho.com/crm/developer/docs/api/v8/get-records.html),
[current user](https://www.zoho.com/crm/developer/docs/api/v8/get-users.html),
[HTTP statuses](https://www.zoho.com/crm/developer/docs/api/v8/status-codes.html).

Refresh preserves an existing refresh token when Zoho omits a replacement.
Expired/revoked grants require reconnect; missing permissions and rate limits
produce distinct errors. No request is retried automatically. Cancellation and
timeouts reach the HTTP request. [Refresh](https://www.zoho.com/crm/developer/docs/api/v8/refresh.html)

`disconnect` removes local connection credentials. To revoke provider access,
open Zoho Accounts, **Connected Apps**, and revoke the appropriate application.
Revocation is separate from deleting this integration's configuration.
[Provider revocation](https://www.zoho.com/developer/oauth/web-server-apps/overview.html)

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

Configure the required Multi DC settings for this client and keep all regional
secrets in the application's private Env. Preserve the selected region with the
connection. Separate clients do not guarantee separate CRM organisation credits;
Zoho's quotas depend on edition, licenses and concurrency.
[API limits](https://www.zoho.com/crm/developer/docs/api/v8/api-limits.html)

## Automation feasibility and current proof

AI can generate this file, validate it, compose the existing library, prepare
callback handlers and guide an authorized operator through the portal. The reviewed
registration instructions describe console creation; a public API for automatically
creating these client registrations has not been established. Account sign-in,
consent, regional enablement, secret assignment and any production/provider review
remain operator/provider steps. The runtime itself does not create registrations.

Focused tests use controlled HTTP responses and temporary encrypted files, covering
regional routing, environment binding, paging, scope enforcement, refresh, ownership,
error handling and interruption. Real accounts, consent, registrations and generated
applications are outside this test pass. Complete connection UI, native/self
client grants, additional regions, arbitrary CRM modules, mutations and provider-side
revocation remain unfinished; the initial read adapter does not imply full API coverage.


## Existing-scope closeout — 13 September 2026

Supported: current user and paged leads, contacts, accounts and deals through
project-owned server OAuth, seven configured data centres and three environments,
explicit fields/page tokens, encrypted local grants and refresh. Source and
offline installed-package tests each pass 11/11. Historical editor form evidence
is retained; the added inline sentence clarifying read-only operation scope was
source-reviewed, not freshly browser-tested.

Full limitations/deferred work: no create/update/delete, relationships mutations,
arbitrary modules, required-field/module metadata discovery, search/query APIs,
bulk jobs, attachments, webhooks or automatic pagination. Full-access scopes do
not add these operations. Named record lists have the documented field/page
bounds; caller owns continuation and must preserve provider tokens per user/query.
No native/self/client-credentials grants, additional regions beyond the configured
seven, region auto-discovery or provider-side revocation. Current-user verification
does not prove module/field permissions. The application supplies callbacks,
organisation/user policy, end-user connection screens and native framework wiring;
connecting CRM is not app sign-in. Disconnect is local. Editor assistant attachment,
live regional OAuth/permissions/data and generated-app execution remain deferred
or unverified. The original broader CRM packet remains backlog.
