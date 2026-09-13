# Chargebee

Import `chargebeeProvider` from `@jskit-ai/connectors-catalog/server/chargebee`.
This adapter manages customers and Product Catalog 2.0 subscriptions, reads catalogue
and invoice data, and creates provider-hosted checkout and customer portal sessions.
Payment details stay in Chargebee-hosted screens. It does not implement OAuth.

## Manual site and credential setup

1. Sign into the Chargebee site as its owner or an administrator. Select the
   intended test or live environment. Copy the site name from its address:
   for `https://acme-test.chargebee.com`, use `acme-test`.
2. Open **Settings → Configure Chargebee → API Keys and Events → API keys**.
   Some documentation/views label the section **API Keys and Webhooks**.
3. Choose **+ Add API Key**. For reads, choose **Read-Only Key** with transactional
   and product-catalog access, or **Read-only: All**. For customer/subscription
   changes, checkout and portal sessions, choose **Full-Access Key**, subtype
   **Write** (create/read/update, without deletion). Name it and choose
   **Create Key**, then retain the issued key securely. A publishable key or
   a key restricted to product-catalog reads is insufficient for this fragment.
4. Store the key under `CHARGEBEE_API_KEY` in the backend environment. Enter
   `env:CHARGEBEE_API_KEY` in Vibe64's API-key reference field and the site name
   in **Site name**. Save the configuration, then choose **Set credential in Env**,
   enter the issued key as `CHARGEBEE_API_KEY`, and save it. Return to the
   integration and choose **Connect account** or **Verify again**. **Check connection**
   only reads saved status. No OAuth callback is required.

Test and live sites use distinct keys. API keys apply to a site, rather than
being restricted to one business entity within it.
[Key types and creation](https://www.chargebee.com/docs/billing/2.0/site-configuration/api_keys).

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "billing": {
      "provider": "chargebee",
      "displayName": "Customer directory",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:CHARGEBEE_API_KEY"
      },
      "settings": { "siteName": "acme-test" }
    }
  }
}
```

The same shared schema validates CLI edits and the UI form. `siteName` accepts
one DNS label, 1–63 letters/digits/hyphens, with a letter or digit at each end.
The operation normalizes its host to lowercase. Full URLs, `.chargebee.com`,
paths, ports, spaces and embedded credentials are rejected. Changing the site
or credential reference requires a fresh runtime verification.

Use the [API-key composition pattern](../patterns/api-key-connection/PATTERN.md)
with `providers: [chargebeeProvider]`, environment-reference resolution and
the file connection store. Configuration and runtime state are text files; the
CLI application does not need an editor or a database. Authorize the requested
application/team context before access to the shared billing connection.

```js
await connections.connectApiKey({ context, integrationId: "billing" });
const page = await connections.invoke({
  context, integrationId: "billing", operation: "customers.list",
  input: { limit: 25, include_deleted: false }
});
// The application can request another page explicitly using page.next_offset.
```

Requests use HTTP Basic authentication with the API key as username and an
empty password. The runtime only sends credentials to the exact configured
`https://<site>.chargebee.com` origin and rejects redirects. Keys remain outside
the portable file and runtime connection records. Rotation updates the
environment binding; a provider rejection marks the connection for verification
again. Disconnect removes local state, not the site's provider key.
[Authentication example](https://www.chargebee.com/docs/billing/2.0/site-configuration/api_keys).

`customers.list` performs `GET /api/v2/customers`. It accepts `limit` from 1–100
(default 10), optional opaque `offset` up to 1000 characters and
`include_deleted` (default false). It returns the provider's `list` entries and
optional `next_offset`. Pass that cursor unchanged for the next page. Empty
lists are valid. Deleted customers are returned only when explicitly requested.
The provider describes this listing as eventually consistent.
[Customer listing](https://apidocs.chargebee.com/docs/api/customers/list-customers).

The fragment preserves customer data and any accompanying resource fields,
checks the response envelope, and does not automatically traverse pages.
The additional operations below supply customer-filtered billing reads and explicit
writes. Sorting and entity-specific access remain native application concerns. The application's policy must control who may read the customer
directory; knowing a Chargebee customer ID is not an authenticated login.

## Automation and application credentials

An AI can prepare the configuration, environment reference, JSKIT composition
and customer-reading code. The reviewed setup documentation describes key
creation through the dashboard; it does not establish a public self-service API
for creating operator accounts, sites or API keys. Treat initial provisioning
as an owner/admin step and do not invent a registration endpoint. A separate
partner arrangement may offer capabilities that are not covered here.

Create an application-specific key on the appropriate Chargebee site. This is
a credential, not an OAuth app registration. When connecting a customer's own billing
system, use its site and authorized key; an operator key cannot access every
customer's Chargebee account. No callback URL is required for this flow, so
editor VM and deployed application domains do not affect registration.

API rate and concurrency limits apply to the site. A second key on the same
site does not create an independent quota. Chargebee returns HTTP 429 when
limits are exceeded; its documentation describes plan-dependent site limits
and a support route for increases.
[Rate limits](https://apidocs.chargebee.com/docs/api/error-handling).
The application owns its credential selection and usage policy. Separate
provider capacity requires the appropriate site/account arrangement. A test
site is not additional production capacity.

## Focused evidence

Six tests use simulated Chargebee replies and real temporary encrypted JSON
files. They cover Basic authentication, file restart, rotation, ownership,
disconnect, unsafe site/credential rejection, site changes, cursors, deleted
records, page-size limits and failures. The editor check covers site validation,
reference-only storage and persistence after reload. Provider signup, live API
requests, billing changes and sample-app generation are excluded.

## Billing operations and recovery

| Operations | Result / boundary |
| --- | --- |
| `customers.list/get/create/update` | Customer directory and profile fields; never raw card details |
| `itemFamilies.list`, `items.list/get`, `itemPrices.list/get` | Product Catalog 2.0 products and configured prices |
| `subscriptions.list/get/create` | Customer-linked subscriptions; direct creation requires explicit auto_collection and invoice_immediately |
| `subscriptions.updateAtTermEnd` | Schedule selected item/quantity changes; explicit replace_items_list controls replacement |
| `subscriptions.cancelAtTermEnd` | Non-renewal at billing term end; does not immediately cancel service |
| `invoices.list/get/pdf` | Invoice/status/line-item data and an expiring PDF link |
| `hostedPages.checkoutNew/checkoutExisting/get` | Hosted new/changed subscription checkout, then authoritative completion details |
| `portalSessions.create` | Customer-authenticated hosted billing management session |
| `events.list/get` | Provider events for application-owned reconciliation |

Inputs use resource IDs as `resource`. New customer creation optionally accepts `id`.
List operations accept limit/offset; subscription and invoice lists accept
`customer_id[is]`, and invoices also accept `subscription_id[is]`. Preserve opaque
pagination offsets. Subscription item arrays contain `{ item_price_id, quantity }`;
the first item must be a plan price in hosted checkout. The adapter encodes Chargebee's
indexed form fields server-side. Product Catalog 1.0 requires native older endpoints.

Every supplied POST requires `idempotencyKey`, a unique application intent identifier
(up to 100 letters/digits/underscores/hyphens). Persist it with the exact intended
request before submitting. The provider's idempotency window is 30 minutes, and the
same key requires the same path, body and headers. The adapter never automatically
replays an uncertain request. After a timeout or beyond that window, reconcile the
customer/subscription/page/event before deciding whether a new request is appropriate.
Do not generate a fresh key for a blind retry. Provider errors remain errors; this
adapter does not expose the response's idempotency-replayed header.

Example flow for DogAndGroom: authenticate the customer in the app, resolve their
server-owned Chargebee customer ID, select a configured recurring item price, then
create hosted checkout with that customer and the app's allowlisted return/cancel URLs.
Keep the hosted page ID bound to that local customer. Send the returned URL to their
browser. After return, retrieve the stored page ID server-side, verify `succeeded`,
its customer/subscription association and actual invoice/subscription state. A query
string saying success and even a succeeded checkout do not independently prove that
an invoice is paid. Offline or deferred collection can leave payment due. The app
must decide access policy and reconcile later events. Never trust a browser-supplied
customer ID to issue a portal session: that URL grants billing-account access.

Use the same service.invoke operations in a standalone Node/CLI application;
Vibe64 only edits the portable configuration. Other frameworks use native Chargebee
SDK/HTTP with these Env bindings, indexed form fields and app-owned intent state.
No Node bridge or Vibe64 server is needed. The existing owner authorization callback
must approve customer, subscription, return destination and financial intent.

**LIMITATIONS:** Editor coding-assistant attachment is deferred. For example, an app
can launch customer checkout and show invoices, but Vibe64's Codex/OpenCode cannot
inspect the billing site through this saved connection. This is a connector, not the
Stripe/Paddle payments product: product authoring, entitlement/credit engines,
webhook receivers, immediate/prorated changes, refunds, contract-term cancellation,
advanced tax/coupon/metered billing and multi-entity controls use native app wiring.
Configure catalogue/prices, payment gateway and portal in Chargebee. No live billing,
provider signup or generated app was exercised. Creating keys does not isolate site quotas.

Sources checked 12 September 2026:
[idempotency](https://apidocs.chargebee.com/docs/api/idempotency),
[hosted checkout](https://apidocs.chargebee.com/docs/api/hosted_pages/create-checkout-for-a-new-subscription),
[subscription creation](https://apidocs.chargebee.com/docs/api/subscriptions/create-subscription-for-items),
[scheduled changes](https://apidocs.chargebee.com/docs/api/subscriptions/update-subscription-for-items),
[cancellation](https://apidocs.chargebee.com/docs/api/subscriptions/cancel-subscription-for-items),
[portal sessions](https://apidocs.chargebee.com/docs/api/portal_sessions/create-a-portal-session).
