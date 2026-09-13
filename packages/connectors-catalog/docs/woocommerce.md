# WooCommerce

Import `woocommerceProvider` from `@jskit-ai/connectors-catalog/server/woocommerce`.
This connector manages products, categories, variations, orders, customers, coupons
and refunds through REST v3, reads store reports, and supplies a webhook signature verifier. The generated app owns its
interface, authorization and event processing. Payment checkout and shopper login
are separate application features.

## Manual setup

1. Sign into the store dashboard. Open **WooCommerce → Settings → Advanced →
   REST API → Add key**.
2. Enter a description, select the intended WordPress user and choose **Read**
   for lookup or **Read/Write** for management operations. Choose **Generate API key**.
3. Copy the consumer key and the once-shown consumer secret. Store the secret
   in the backend environment as `WOOCOMMERCE_CONSUMER_SECRET`.
4. In the editor enter **Store URL**, **Consumer key** and **Consumer secret
   reference** (`env:WOOCOMMERCE_CONSUMER_SECRET`). Save configuration.

The key's access also depends on the selected user's permissions. Revoke it
from the REST API key list when access should end.
[WooCommerce authentication](https://developer.woocommerce.com/docs/apis/rest-api/authentication/).

Use the final HTTPS site address before `/wp-json`, retaining an installation
subdirectory. Under **Settings → Permalinks**, use a pretty permalink structure;
the default plain structure does not support these REST routes.
[REST API requirements](https://developer.woocommerce.com/docs/apis/rest-api/).

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "store": {
      "provider": "woocommerce",
      "displayName": "Store catalogue",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:WOOCOMMERCE_CONSUMER_SECRET"
      },
      "settings": {
        "siteUrl": "https://merchant.example/store/",
        "consumerKey": "ck_example123"
      }
    }
  }
}
```

The key identifier is saved in source; its matching secret is resolved outside
source. CLI and editor use the same schema. Compose the
[API-key pattern](../patterns/api-key-connection/PATTERN.md) with
`providers: [woocommerceProvider]` and the encrypted file connection store.
Both configuration and runtime state use text files, without an editor or
database dependency. The application authorizes access to the shared store.

```js
await connections.connectApiKey({ context, integrationId: "store" });
const products = await connections.invoke({
  context, integrationId: "store", operation: "products.list",
  input: { page: 1, per_page: 25, stock_status: "instock" }
});
const orders = await connections.invoke({
  context, integrationId: "store", operation: "orders.list",
  input: { page: 1, per_page: 10, status: "processing" }
});
```

Verification reads authenticated `GET /wp-json/wc/v3/products`. An empty array
is valid; an error object is not. This is not the public Store API, and product
access does not establish order permission. The product operation accepts
`page`, `per_page`, `search`, `status`, `sku` and `stock_status`.
[Products](https://developer.woocommerce.com/docs/apis/rest-api/v3/products/).

`orders.list` reads `/wp-json/wc/v3/orders` and accepts `page`, `per_page`,
`search`, `status` and `customer` (including zero for guest orders). Currency
totals remain strings in the provider response.
[Orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/).

Both operations default to page 1, ten records and status `any`. The fragment
bounds page size to 1–100 and page to 1–100000; search is limited to 500
characters. It returns one response array without exposing pagination headers
or traversing pages. Product/order links and image URLs are returned as data
and never fetched automatically. The application decides what to display and
whether to request another page.

Credentials use Basic authentication only in the header, and redirects fail.
If a proxy strips Authorization, correct that forwarding configuration; this
adapter has no query-string credential fallback. A changed site, path or key
identifier requires verification again. Environment rotation changes the
secret binding. Disconnect removes the local connection record, not the store
key.

The configured HTTPS address may use a private host or nondefault port for
operator-owned stores. URL validation rejects embedded credentials, query,
fragment and parent-path segments; it is not a DNS or SSRF filter. Only trusted
configuration editors may choose the credential destination. The hosting
application owns outbound-network restrictions. Operation input cannot replace
that destination, and credentials are restricted to its exact origin.

## Automation and application ownership

An AI can prepare configuration and runtime wiring. WooCommerce also documents
an owner-consent flow at `/wc-auth/v1/authorize`, with application name, scope,
correlation ID, return URL and HTTPS callback URL. Credentials arrive by a
separate POST to the callback; the browser's success return is insufficient.
That bootstrap is not implemented by this fragment.
[Application authentication](https://developer.woocommerce.com/docs/apis/rest-api/authentication/).

For manual setup, each customer supplies its own store key. There is no global
OAuth registration in this flow. Separate application keys give connections distinct revocation and
audit identities. They do not establish separate hosting capacity. Application
usage limits belong in its backend; store infrastructure remains shared
unless its owner separates it. Do not promise a new quota merely from a new key.

Manual Basic authentication needs no callback and is independent of the editor
VM's domain. An eventual consent implementation must route the credential POST
to its application backend, authenticate and correlate its bootstrap,
then return the browser to the correct project. Store address changes require
configuration updates; redirects do not migrate authenticated requests.

## Focused proof and limits

The WordPress-family suite uses simulated HTTP and actual encrypted JSON files.
It covers Basic headers, restart, rotation, ownership, disconnect, changed
destinations, subdirectories, validation, pagination and failure responses.
Editor checks cover required fields, invalid URLs/identifiers, raw-secret
rejection, setup links and save/reload. Live signup, consent, store operations
and sample-app generation are excluded. Controlled operation tests cover native
write bodies, validation, identity mismatches, uncertain writes and webhook
signatures. Custom order statuses and the automatic key-consent flow are not
implemented. Expanded/compact configuration and lifecycle checks passed; the
latest compact pass also checks refund and reporting guidance. The isolated
installed-package suite passed 26/26 with controlled HTTP and file storage.


## Store record discovery

Use `customers.list({ page, per_page, search, email })` or
`coupons.list({ page, per_page, search, code })` for explicit pages. Individual
`products.get`, `orders.get`, `customers.get` and `coupons.get` accept `{ id }`.
They call the corresponding `/wp-json/wc/v3/{resource}/{id}` endpoint beneath
the configured store path. Native addresses, prices and coupon amounts are
preserved; decimal money stays text. Unknown/mismatched record IDs are rejected.
No linked address is fetched and no next page is requested automatically.

The selected WordPress user's permissions govern these reads. A successful
product verification does not prove access to customers or coupons. Keep the
consumer secret in server Env and authorize each visitor's resource access in
your app; the store administrator key is not a visitor session. Other frameworks
use the same Basic-auth credentials and native REST routes. The management and
webhook operations are described below.

Sources: [Customers](https://developer.woocommerce.com/docs/apis/rest-api/v3/customers/),
[Coupons](https://developer.woocommerce.com/docs/apis/rest-api/v3/coupons/).


## Coupon changes

For writes, generate a **Read/Write** key in WooCommerce > Settings > Advanced >
REST API under the intended store administrator, then replace the matching Env
secret and configured consumer key. Read-only keys remain suitable for lookup.
Your backend authorizes promotion management and reviews the changes before
calling `coupons.create` or `coupons.update`. Updates require `id`; creation
requires `code`. Both accept native discount type, decimal amount, min/max spend,
usage limits, product/category inclusion/exclusion, email restrictions and flags.
Explicit false, empty description and empty restriction lists are preserved.

Creation POSTs JSON to `/wp-json/wc/v3/coupons`; updates PUT only supplied fields
to `/wp-json/wc/v3/coupons/{id}`. Use decimal strings, never floating-point money.
Percentage validation on updates without a supplied type remains WooCommerce's
responsibility: retrieve the existing coupon when reviewing such changes.
Free shipping requires the store's compatible shipping method. An uncertain
response must be reconciled using coupon code/ID before a deliberate retry.
No automatic retry, expiry editing, metadata editing or promotion UI is provided
by these operations. Coupon removal uses the separate coupons.delete operation. The application owns those presentation and
workflow decisions; other frameworks send the same native REST payloads.


## Order status changes

`orders.update({ id, status, customer_note })` PUTs only supplied fields to
`/wp-json/wc/v3/orders/{id}`. Use a Read/Write key and explicitly authorize the
order manager. Read the order and review its current state before changing it;
no revision-based concurrency guarantee is supplied. An empty customer_note
clears the customer's checkout note; it is not a private staff annotation.

Status changes can trigger WooCommerce/plugin emails and stock-related actions.
Marking an order completed is not a payment request, and setting refunded does
not itself issue a gateway refund. This operation does not accept set_paid or
transaction_id; use a separately reviewed payment/refund workflow where needed.
On an uncertain result, reread the order before deciding whether to retry.

Reference: [WooCommerce orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/).


### Customer profiles and addresses

Grant **Read/Write** in WooCommerce → Settings → Advanced → REST API when
creating the project's key for customer changes. `customers.create` requires
`email` and accepts `username`, `first_name`, `last_name`, `billing` and `shipping`.
`customers.update` requires the store customer `id` and accepts email, names and
partial billing/shipping addresses. Omitted fields remain omitted; an empty
address field explicitly clears that field. Postal codes stay strings.
These use native POST/PUT `/wp-json/wc/v3/customers` routes, with `/{id}` for updates.
See [WooCommerce customer API](https://developer.woocommerce.com/docs/apis/rest-api/v3/customers/).

The generated app must authorize access to each customer record. A store
customer record does not log someone into the generated app. Store account
creation and notifications follow WooCommerce configuration/plugins. Password
management, role changes and arbitrary customer metadata are not exposed by
these operations. The store handles duplicate emails and account validation.
After an uncertain create response, look up the email before retrying; the
connector does not automatically replay writes. Read the current record before
editing it; these operations do not provide optimistic concurrency control.


### Product prices and inventory

`products.create` requires `name` and an explicit `status` (choose `draft` for
review). `products.update` requires `id` and only sends supplied changes.
Both support simple/variable product types, descriptions, SKU, decimal-string
regular/sale prices, stock management, absolute stock quantities, stock status,
backorders, flags, existing category IDs and existing media attachment IDs.
These use native POST/PUT product routes; see the
[product API](https://developer.woocommerce.com/docs/apis/rest-api/v3/products/).
Use a Read/Write key, selected under WooCommerce → Settings → Advanced → REST API.

An empty price clears it; zero, negative stock, false flags and empty category
lists are preserved. Stock writes replace quantities, not increment them. Your
app must review concurrent sales before overwriting inventory; this connector
has no locking or inventory ledger. Publishing and updates affect the live store.
Image uploads, external image fetching, grouped/external product configuration,
download delivery and arbitrary metadata are not provided by these operations.
HTML descriptions need appropriate sanitization when rendered by your app.
After uncertain writes, retrieve the product or search its SKU before retrying.


### Existing product variations

List with `variations.list({ product_id, page, per_page })`, then use
`variations.get({ product_id, id })` or `variations.update` with both IDs.
The connector retains the native attributes and price. Updates accept decimal
regular/sale prices, SKU, publication status, boolean stock management, absolute
quantity, stock status and backorder policy. These use the store's native
`products/{product_id}/variations/{id}` routes; see
[variation API](https://developer.woocommerce.com/docs/apis/rest-api/v3/product-variations/).

Use Read/Write credentials for changes. Check whether stock belongs to the parent
or variation before changing it. This update currently accepts boolean
`manage_stock`, not the provider's `parent` sentinel. Custom named attributes can be configured on the parent and selected on each
variation; global attribute taxonomy administration is not exposed. The app owns
selection, authorization and review; updates can immediately change availability
and prices at checkout. Pages are bounded and must be requested individually.


### Removing records

Products, orders and coupons expose `.delete({ id, force })`: explicitly choose
`false` for trash or `true` for permanent removal. Customers and variations
require `force: true` because they do not support trash. Variation deletion also
requires `product_id`; customer deletion accepts `reassign` for posts owned by
the removed WordPress user. Review that user's content before deleting them.

Use Read/Write credentials and require app authorization and confirmation of the
exact record and effect. Deleting an order does not refund a payment. Permanent
removal cannot be undone through this connector; removal may affect storefront
availability and plugin behaviour. A failed request is not replayed automatically.
Reconcile uncertain outcomes by retrieving the record before trying again.


### Creating a size/colour catalogue

1. Call `products.create` with `type: "variable"`, `status: "draft"` and named
   `attributes`, for example `{ name: "Size", variation: true, visible: true,
   options: ["S", "M"] }`. Keep the returned parent ID.
2. Call `variations.create` with that `product_id`, explicit `status`, decimal
   price and `attributes: [{ name: "Size", option: "M" }]`. Create only the
   combinations the administrator requests. The connector never fans out writes.
3. Review parent and variation records before publishing them through updates.
   The store remains authoritative about attribute compatibility and purchasability.

Attribute arrays are replacements; retain other options when updating a parent.
Only custom named attributes are currently supported for writes, not global
attribute-ID administration. This is not an atomic catalogue transaction: preserve
successful IDs and reconcile failures before retrying subsequent creation calls.


### Creating an order record

`orders.create` requires an explicit `customer_id` (0 for a guest), `status`
(`pending` or `on-hold`) and 1–100 `line_items`, each with `product_id`, positive
`quantity` and optional `variation_id`. It also accepts billing/shipping addresses,
`customer_note` and coupon codes through `coupon_lines`. The response is the native
order, including its ID and decimal total. See the
[order API](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/).

Use a Read/Write key and authorize the customer/order on your backend. Pass the
intended order addresses explicitly; do not assume selecting a customer copies
all address data. This is order administration, not a cart or payment checkout.
It does not charge a card, set a paid flag, verify stock reservations or quote
shipping. Gateway checkout, shipping-rate selection, fee lines and manual
total overrides remain outside this operation. Store plugins and status changes
can trigger emails or stock effects. Inspect WooCommerce's returned totals and
store configuration before presenting an order as ready for payment.

Save the returned order ID. On a timeout or uncertain write, reconcile the store's
orders for the customer before retrying; there is no atomic idempotency guarantee.


### Receiving store events

Create a project-owned HTTPS receiver before enabling notifications. In the store,
open **WooCommerce → Settings → Advanced → Webhooks → Add webhook**. Choose a
name, topic and delivery URL. Enter a distinct random signing secret, save the
same value in the app's Env (for example `WOOCOMMERCE_WEBHOOK_SECRET`), then set
Active and save. See [webhook setup](https://woocommerce.com/document/webhooks/).
To stop deliveries, pause/delete the webhook there; disconnecting an API key in
the app does not remove store webhooks. Inspect **WooCommerce → Status → Logs**
for delivery failures.

Import `verifyWooCommerceWebhook` from `@jskit-ai/connectors-catalog/server/woocommerce`.
Pass the exact incoming bytes as `rawBody`, the single `X-WC-Webhook-Signature`
header as `signature`, and the route's Env signing `secret`. It returns true or
throws `connector_webhook_invalid`. It supports the default SHA-256 algorithm
and a 2 MiB body limit; enforce that limit while reading the request too.
Verify before JSON parsing or side effects. Do not stringify a parsed body to
reconstruct signed bytes.

The signature covers the body, not topic/source/delivery headers, and has no
signed timestamp. Bind the receiver and secret to the configured store; do not
select credentials or grant authorization from supplied headers. Persist
idempotent processing in the generated app, and reconcile current resource state
when event ordering matters. A valid signature alone does not prevent replay.
The initial activation ping is separate and unsigned; acknowledge it without
processing a business event. Native frameworks implement the same base64
HMAC-SHA256 check with constant-time comparison. Provider code reference:
[WooCommerce webhook implementation](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/class-wc-webhook.php).


### Product categories

Use `categories.list` with page/per_page/search and optional `parent` and
`hide_empty`; `categories.get` needs `id`. Create requires `name`; update requires
`id` and supplied changes. Supported fields are name, slug, description, parent,
display, menu_order and an existing image ID. Parent 0 selects the root.
Use returned category IDs in product category arrays. The store validates deeper
hierarchy cycles and taxonomy constraints. Routes are
`/wp-json/wc/v3/products/categories[/{id}]`.

A Read/Write key is required for changes. `categories.delete({ id, force: true })`
is permanent; the app must review affected catalogue organization first. The
operation does not delete products. Image uploads and external image retrieval
are outside this operation. Store navigation and category archives can change
immediately. Reference:
[WooCommerce categories](https://developer.woocommerce.com/docs/apis/rest-api/v3/product-categories/).


### Sales and resource reports

Use `reports.sales` or `reports.topSellers` with either `period` (week, month,
last_month, year) or a complete `date_min`/`date_max` YYYY-MM-DD range.
`reports.orders`, `reports.products`, `reports.customers` and `reports.coupons`
return native resource-summary counts. Read permissions are sufficient only when
the key's WordPress user also has reporting capabilities. A product probe does
not prove report access. These operations retain native response values; the app
owns charting, comparisons, exports and choosing the store's reporting period.

Sales responses retain decimal strings and per-period buckets. WooCommerce's
aggregate refund figure and bucket refunds can use different date semantics;
do not assume they reconcile identically. These REST v3 reports are not a clone
of every WooCommerce Analytics dashboard. Reference:
[WooCommerce reports](https://developer.woocommerce.com/docs/apis/rest-api/v3/reports/).


### Refunds

Read `refunds.list({ order_id, page, per_page })` or `refunds.get({ order_id, id })`.
`refunds.create` requires order_id, decimal-string amount, reason, and explicit
boolean api_refund/api_restock. With api_refund true, WooCommerce asks the order's
payment gateway to return money; false records a manual refund only. Confirm the
returned refunded_payment value and reconcile with the gateway when uncertain.

Restocking requires selected original order-line IDs with quantities and decimal
refund_total values. These are order-line IDs, not product IDs. Review remaining
refundable amounts/quantities before submitting. The top-level amount takes
precedence over line totals; your app must reconcile the requested amounts.
Tax allocation, fee/shipping refund lines and server-computed refund totals are
not exposed by this operation. Native routes are orders/{order_id}/refunds.

Use Read/Write credentials and a gateway that supports API refunds. The app owns
refund authorization and confirmation. Requests are sent once; after timeout or
failure, inspect existing refunds and gateway history before retrying. Refunds
can trigger store notifications and stock changes. This connector does not
reverse gateway transfers or supply cross-system idempotency. See
[WooCommerce refunds](https://developer.woocommerce.com/docs/apis/rest-api/v3/order-refunds/).
