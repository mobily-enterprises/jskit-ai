# PrestaShop

Import `prestashopProvider` from `@jskit-ai/connectors-catalog/server/prestashop`.
This fragment reads products and orders through the store's Webservice API.
The application's authenticated policy controls access to this shared store;
it is not shopper login or a connection to each shopper's store account.

## Manual setup

1. Sign into the store's back office. Open **Advanced Parameters → Webservice**,
   enable **PrestaShop Webservice**, and save.
2. Choose **Add new webservice key → Generate**. Add a recognizable description
   and enable the key.
3. Grant **GET** for **products**. Add **GET** for **orders** if needed. In
   multistore mode, select the intended shop association. Save.
4. Store the generated key in your backend environment as
   `PRESTASHOP_WEBSERVICE_KEY`. Keep it out of application source.
5. In the integration form enter **Store URL** and **Webservice API key
   reference** (`env:PRESTASHOP_WEBSERVICE_KEY`), then save configuration.

Disable or replace keys through the same Webservice screen.
[Webservice setup](https://devdocs.prestashop-project.org/9/webservice/tutorials/creating-access/).

Use the final HTTPS store address before `/api`, including any installation
subdirectory. The webserver must route that API path correctly and forward
Authorization. The adapter sends the key as a Basic-auth username with an empty
password, requests `output_format=JSON`, and rejects redirects. It has no
URL-credential fallback. JSON is an output format for this API; this fragment
implements no XML writes.
[Webservice protocol](https://devdocs.prestashop-project.org/9/webservice/getting-started/).

## Portable configuration and CLI wiring

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "store": {
      "provider": "prestashop",
      "displayName": "Store catalogue",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:PRESTASHOP_WEBSERVICE_KEY"
      },
      "settings": { "siteUrl": "https://merchant.example/store/" }
    }
  }
}
```

Compose the [API-key source pattern](../patterns/api-key-connection/PATTERN.md)
with `providers: [prestashopProvider]`. CLI and editor use the same configuration
parser and provider definition. `createFileConnectionStore` keeps runtime state
in encrypted JSON outside application source; no editor or database is needed.
Supply the application's authorization policy and environment reference resolver.

```js
await connections.connectApiKey({ context, integrationId: "store" });
const products = await connections.invoke({
  context, integrationId: "store", operation: "products.list",
  input: { offset: 0, limit: 25, language: 1 }
});
const orders = await connections.invoke({
  context, integrationId: "store", operation: "orders.list",
  input: { offset: 0, limit: 10 }
});
```

Verification performs `products.list`. It proves that request succeeded, not
order access. Both operations request full records sorted by ascending ID.
Inputs are `offset` (0–1000000, default 0), `limit` (1–100, default 20), and
optional positive integer `language`. These are fragment bounds. Offset and
limit become the provider's `limit=offset,limit` parameter. Each call fetches
one page; the caller decides whether to request another.
[List parameters](https://devdocs.prestashop-project.org/9/webservice/tutorials/advanced-use/additional-list-parameters/).

Responses remain unchanged: usually `{ products: [...] }` or `{ orders: [...] }`.
An empty `[]` is also valid. PrestaShop's JSON writer can emit that shape when
there are no resource nodes. Multilingual fields may be strings or language
arrays, and IDs/decimal values can be strings. Preserve them when displaying
or processing the result; associated resources are not fetched automatically.
[Provider JSON writer](https://github.com/PrestaShop/PrestaShop/blob/9.0.0/classes/webservice/WebserviceOutputJSON.php).

Changing the store URL or credential reference requires verification again.
Environment key rotation takes effect on the next request. Disconnect removes
the local grant; it does not revoke the store key. HTTP permission, credential,
quota and transport failures remain errors; no request is replayed automatically.

The store URL may contain a private host, port or installation path. The shared
validator rejects embedded credentials, query, fragment and parent-path
segments. It does not perform DNS filtering. The application controls who can
edit this credential destination and what networks its backend can reach.
Operation input cannot substitute a different URL.

## Automation and Online ownership

An AI can prepare the JSON and runtime wiring. With authorized access to the
store's PHP runtime, provider APIs can enable `PS_WEBSERVICE`, create a
`WebserviceKey`, and assign resource methods using
`WebserviceKey::setPermissionForAccount`. This is local store administration,
not an unauthenticated remote registration endpoint. This fragment does not
execute provisioning PHP or alter shop permissions.
[Programmatic setup](https://devdocs.prestashop-project.org/9/webservice/tutorials/creating-access/).

There is no universal OAuth callback for this mode. Each merchant owns its
store key. Separate application keys can separate access and revocation, but do not create
separate store capacity. Two keys on one server are not evidence of separate
provider quotas.

The editor VM and application custom domain need no provider redirect
registration. If the store itself changes address, update `siteUrl` and
re-verify it. The application retains its credential in private Env and enforces
access through its own authorization policy. See the
[application setup contract](../../connectors-core/docs/online-setup.md).

## Focused proof and remaining work

Automated tests use controlled HTTP and real encrypted temporary files. They
cover Basic headers, subdirectories, restart, rotation, isolation, policy,
changed destinations, bounded pages, empty/malformed replies, permission errors
and interruption without replay. Editor checks cover required URL validation,
raw-secret rejection, references, setup guidance and save/reload.

Live stores and sample application generation are outside this proof. Product
writes, order processing, stock changes, additional filters, explicit multistore
selection per request, webhooks and complete account-connection UI
remain outside this fragment. The newer Admin API is a separate protocol.


## Existing-scope closeout — 13 September 2026

The supported surface is `products.list` and `orders.list` with explicit
pagination/language, a merchant-owned Webservice key and the configured HTTPS
store path. Source and offline installed-package tests each pass 7/7. Historical
editor form checks are retained; no fresh browser run or runtime/form change was
made for this closeout. This is not full commerce or Lovable parity.

Full deferred work: product/order writes and XML write composition, customer and
inventory resource operations, stock updates, checkout/payments, fulfilment,
refunds, carts, additional search/filter/detail operations, automatic traversal
of associations, webhooks, automatic pagination, retries and newer Admin API
support. Multistore association belongs to the key configuration; there is no
per-request shop selector. No OAuth, shopper authentication or per-shopper grants.
The application owns business UI, routes, access policy and native framework
composition. Verification reads products only and cannot establish order access.
Disconnect removes local state; disable/revoke the key in the merchant back office.
Editor coding-agent attachment remains deferred. Live store compatibility,
actual permissions/data and generated-app execution have not been verified.
