# Lightspeed Retail X-Series

Import `lightspeedProvider` from `@jskit-ai/connectors-catalog/server/lightspeed`.
This first fragment provides OAuth and three read operations through the existing
connection service and encrypted file store. CLI and editor users share the same
configuration contract. Saving the file does not connect a store.

## Create the provider registration

1. Open the [X-Series developer portal](https://developers.retail.lightspeed.app/).
   Register a developer account; a retail-store login is a separate account.
2. Sign in, open **Applications**, and choose **Create**. Enter the application
   details requested by the portal and your backend's exact redirect URI.
3. Copy **Client ID** into the form and **Save configuration**. Use
   **Set credential in Env** for **Client Secret** and **Set callback in Env**
   for the exact registered redirect URI. Save Env values, then return to the
   integration. The application backend must implement that route.
4. Copy the store prefix from its `https://PREFIX.retail.lightspeed.app` address.
   Configure that store before starting authorization.
5. Save the file, call `beginAuthorization`, and open its URL in a system browser.
   Authorize the intended retailer. Pass the callback to `completeAuthorization`
   with the same authenticated owner. Use explicit local cancellation if a declined
   callback lacks state; do not associate it with an arbitrary pending attempt.
6. New registrations initially allow 30 stores. Request provider approval before
   operating a public production integration. Personal tokens are a separate
   option, outside this OAuth fragment. [Authorization](https://x-series-api.lightspeedhq.com/docs/authorization)

## Portable configuration and editor fields

```json
{
  "schemaVersion": 1,
  "registrations": {
    "lightspeed": {
      "source": "own",
      "clientId": "REPLACE_WITH_LIGHTSPEED_CLIENT_ID",
      "clientSecretRef": "env:LIGHTSPEED_CLIENT_SECRET",
      "callbackUrlRef": "env:LIGHTSPEED_CALLBACK_URL"
    }
  },
  "integrations": {
    "retail": {
      "provider": "lightspeed",
      "displayName": "Store inventory",
      "accountMode": "shared",
      "authentication": { "method": "oauth2", "registrationRef": "lightspeed" },
      "settings": { "domainPrefix": "your-store" },
      "scopes": ["products:read", "customers:read", "outlets:read"]
    }
  }
}
```

In Vibe64, add **Lightspeed** in **Integrations**, choose the account mode, and
enter **Client ID**, **Client secret reference**, **Callback URL reference** and
**Domain prefix**. Edit permissions, then **Save configuration**. The client
authentication method defaults to `client_secret_post`. Use reference values,
not raw secrets or a literal callback URL. The domain field accepts a lowercase
DNS label, not a whole URL. It cannot select arbitrary external hosts.

The initial form includes 49 permission choices and initially selects 16 reads.
The JSON above narrows access to the three implemented operations. Retain
`products:read` for connection verification. Other selectable permissions record
an intended grant; they do not implement additional operations. Provider scopes
are space-separated and the runtime respects the actual token grant.
[Scope reference](https://x-series-api.lightspeedhq.com/docs/scopes)

`shared` means the host deliberately authorizes several app users to use one
store connection. `per-user` gives each authenticated subject a separate grant;
the configured store still applies to that slot. `assistant` uses the assistant
owner. The host's `authorize` policy establishes those owners and any narrower
record permissions. This configuration does not implement app login.

## Runtime and operation contract

| Operation | Required scope | Result |
| --- | --- | --- |
| `products.list` | `products:read` | Product page; also used for verification |
| `customers.list` | `customers:read` | Customer page, preserving nullable fields |
| `outlets.list` | `outlets:read` | Outlet page |

All three accept `page_size` 1–100 (library default 20), optional integer `after`
and `before` version bounds, and `deleted` (default false). This fragment bounds
page size to 100; it does not assert that as the provider's maximum. Version
numbers must fit JavaScript's safe integer range. A combined lower bound must be
less than its upper bound. Unknown inputs, arbitrary destinations, name/SKU
searches and writes are rejected before transport.

Each invocation requests exactly one page and preserves provider records and
version metadata. The caller chooses whether to request the next version page;
there is no background traversal. Empty pages use null version bounds. The
customer reference also permits an absent envelope version; row versions remain
available. Missing IDs, unsafe versions, contradictory bounds and oversized
responses fail validation. [Products](https://x-series-api.lightspeedhq.com/reference/listproducts),
[customers](https://x-series-api.lightspeedhq.com/reference/listcustomers),
[outlets](https://x-series-api.lightspeedhq.com/reference/listoutlets).

The adapter pins `/api/2026-07/` reads. Lightspeed uses quarterly dated releases
with at least twelve months of support and can serve an older requested version
through a supported fallback after expiry. Review this pin against provider
changes; it is not a promise of an immutable remote API.
[Version policy](https://x-series-api.lightspeedhq.com/docs/versioning-strategy)

Authorization starts at `https://secure.retail.lightspeed.app/connect`.
Token exchange uses the configured store's `/api/1.0/token`; callback-supplied
hosts never choose the credential destination. Successful token responses must
identify that store and include scopes, expiry and a refresh token. Every rotated
refresh token is saved before the next read. The shared runtime sends PKCE;
Lightspeed's reviewed guide does not establish its enforcement. Verify that
behavior with an approved test registration before production use.

Cancellation reaches transport. Rate limits, missing permissions and revoked
access have separate errors; calls are not retried automatically. A local
`disconnect` deletes the stored grant without revoking it at the provider. If
refresh returns an incomplete grant after consuming the old token, reconnect;
do not repeatedly retry the spent refresh token.

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

The owner must obtain any required Lightspeed approval and retain the configured
store prefix with the application's connection. Separate registrations alone do
not prove independent provider quotas; confirm capacity at the provider account
or store boundary before promising isolation.

## Automation, CLI parity and proof

An AI can write and validate this JSON, compose the JSKIT service and file store,
wire an authenticated callback and implement explicit page presentation. There
is no verified public registration-provisioning API in the reviewed material;
do not invent one. Account creation, store consent and public-app approval remain
operator/provider steps. Authorized browser assistance can help with available
portal fields without guaranteeing unattended account creation or approval.

A trusted CLI uses the same library, references and owner policy with a registered
callback listener. The open-source editor never needs a database to edit this
file and must not bundle a commercial client secret. Provider setup and runtime
operations are reusable package code; the app owns routes, rendering and policy.

Local proof uses controlled HTTP responses and temporary encrypted files. It
covers scopes, store binding, refresh rotation, ownership, pagination, malformed
responses, cancellation and editor persistence. No live retail account, provider
registration, consent, data mutation or generated app was used. R-Series,
K-Series, personal-token mode, webhook setup and additional API operations are
outside this initial fragment.

Credential instructions were rechecked against the official authorization guide
on 2026-09-12. Screen steps now name the Env handoff, fixed store slot, shared
and per-user connection entry points, explicit cancellation and local disconnect.
Updated rendered review passed with simulated connection responses.

## Inventory and sales reads

`sales.list` uses the same version bounds/page_size as product pages, without
a deleted filter. It requires sales:read. Correlate customer/outlet/product IDs
in the returned sale with the app's authorized records. The app owns reporting,
privacy and any aggregation; this connector installs no dashboard.

`inventory.list` requires inventory:read and POSTs a read request to
`/api/2026-07/inventory`. Input: after/before version bounds, size (local1–1000,
default100), include_deleted, sort_direction (defaultasc), product_id and variants.
Request variants only with a product ID. It returns a flat array, not a data
wrapper. Preserve current_inventory_level and quantity_to_procure separately.
Advance an ascending scan explicitly using the maximum returned version; never
follow a provider-supplied URL with credentials. The app controls polling and
reconciliation during concurrent stock changes.

[Inventory contract](https://x-series-api.lightspeedhq.com/reference/listinventoryrecords),
[quantity migration](https://x-series-api.lightspeedhq.com/docs/2026-04-release-notes),
[sales pages](https://x-series-api.lightspeedhq.com/reference/listsales).

A CLI app uses these same connection operations. Other frameworks implement
native HTTP calls with their own project-owned OAuth grant and the same JSON/Env
contract; no Vibe64 runtime or JSKIT sidecar is required.

**LIMITATIONS:** No POS/dashboard UI, customer/product/stock/payment/sale writes,
gift-card/store-credit workflows, webhook receiver or automatic editor tool
attachment. Example: an app can report low stock and sales totals, but cannot
replenish a shelf or charge a customer through this adapter. Adding a write scope
does not implement a write operation. No live retailer or generated app was used.
