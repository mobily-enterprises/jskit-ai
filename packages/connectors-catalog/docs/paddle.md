# Paddle

Import `paddleProvider` from `@jskit-ai/connectors-catalog/server/paddle`.
This adapter reads a Paddle Billing product catalogue and creates products and prices. Checkout creation,
merchant activation and payment processing are separate application work.

## Configure access

First [create or sign into your own Paddle account](https://login.paddle.com/signup).
Follow Paddle's [account signup instructions](https://www.paddle.com/help/start/intro-to-paddle/essentials-to-sign-upcreate-a-paddle-account)
and complete the requested seller verification in its dashboard. Use a sandbox
account for testing; a saved sandbox key does not approve your business or enable
live payments. The merchant is the business receiving payments, not a customer
or business record created through the billing API.

1. Sign into the intended Paddle sandbox or live account. Open **Developer
   tools → Authentication → API keys → New API key**.
2. Enter a descriptive name, choose the `product.read` permission and an expiry
   appropriate to your application. Add `product.write` for product creation and
   `price.write` for price creation, and `notification_setting.write` to edit
   notification destinations. Save the key and copy its secret when shown.
   This is a backend API key; a frontend client token cannot replace it.
   [Authentication setup](https://developer.paddle.com/api-reference/about/authentication).
3. Put the secret in backend Env as `PADDLE_API_KEY`. Save provider `paddle`,
   mode `shared` or `assistant`, `scopes: []`, and authentication
   `{ "method": "api-key", "secretRef": "env:PADDLE_API_KEY" }`.
4. Set `settings.environment` to `sandbox` (the default) or `live`, matching the
   account that issued the key. The editor exposes the same choice as
   **Environment**. Sandbox calls use `https://sandbox-api.paddle.com`; live
   calls use `https://api.paddle.com`. Requests specify `Paddle-Version: 1`.
   [API environments](https://developer.paddle.com/api-reference/about).
5. Call `connectApiKey` to verify product access. A changed environment requires
   verification again. Local disconnect removes local access state; revoke a
   key in the Paddle dashboard when remote access should end.

## Runtime and AI composition

`products.list` calls `GET /products`. Inputs are `per_page` (1–200, default
50), `after` (the previous page's final product ID), and `status` (`active` by
default or `archived`). Results retain `data` and `meta.pagination`, including
`has_more`. Extract the next cursor rather than treating a returned URL as an
arbitrary authenticated request destination.
[Product listing](https://developer.paddle.com/api-reference/products/list-products).

`products.create` calls `POST /products`. Supply `name` (1–200 characters),
`tax_category` from the provider's supported categories, and optionally
`description` (up to 2048 characters). It creates the product only; retain its
returned `data.id` for the next operation.
[Create product](https://developer.paddle.com/api-reference/products/create-product/).

`prices.create` calls `POST /prices`. Supply `product_id`, `description`
(2–500 characters), and `unit_price: { amount: "1200", currency_code: "USD" }`.
Amounts are integer strings in the currency's smallest unit. The currency must
be supported by Paddle. Omit `billing_cycle` for a one-time price, or supply
`{ interval: "month", frequency: 1 }` for a monthly recurring price. Other
intervals are `day`, `week` and `year`, with a positive integer frequency.
[Create price](https://developer.paddle.com/api-reference/prices/create-price/).

Product and price writes are separate requests, not an atomic transaction.
If price creation fails after product creation, retain the product ID and
resolve the failed price step rather than recreating the product. The adapter
does not retry failed writes. A network failure can leave an unknown outcome;
inspect the merchant catalogue before deciding whether to repeat the action.
These operations create catalogue entries; they do not charge a customer.

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) and the file
connection store. An AI can compose a product picker from this operation without
creating transactions. Unsupported settings and excessive page sizes fail
locally. Tests exercise sandbox/live routing, verification, result validation,
file restart, ownership and failure handling with simulated HTTP responses.

## Edit a webhook destination

In Paddle, open **Developer tools → Notifications**, choose the destination's
menu, then **Edit destination**. The same change can be made by calling
`webhooks.update` with its `notification_setting_id` (`ntfset_…`) and the fields
to change. At least one change is required. Supported fields are `description`,
`destination`, `active`, `api_version`, `include_sensitive_fields`,
`subscribed_events`, and `traffic_source` (`platform`, `simulation`, or `all`).
The provider validates the destination against its existing URL/email type.
[Update API](https://developer.paddle.com/api-reference/notification-settings/update-notification-setting/).

Send the **complete desired event list** when changing `subscribed_events`;
omitted events are unsubscribed. Omit the field to preserve subscriptions.
The adapter keeps omitted settings unchanged and removes `endpoint_secret_key`
from the result. Store the signing secret separately in the app's backend Env
when provisioning the destination. The application owns the HTTP receiver,
signature verification and event handling. This operation neither creates
that receiver nor confirms that deliveries succeed.
[Dashboard instructions](https://developer.paddle.com/webhooks/about/notification-destinations/).

## Domain approval and going live

`checkoutDomains.get` accepts `domain_id` (`chedom_…`) and reads the provider's
approval status. Grant `checkout_domain.read` to the API key. In assistant mode
this operation uses the `goLive.check` policy. Preserve the returned status:
`pending_review`, `in_review`, `action_required`, `rejected`, or `approved`.
An approved domain does not establish seller verification, working checkout,
correct app entitlements or successful webhook delivery.
[Domain status API](https://developer.paddle.com/api-reference/checkout-domains/get-checkout-domain/).

For production, use Paddle's dashboard to complete seller setup. Configure
**Checkout → Checkout settings** with the approved website's payment link.
Review **Catalog → Products** and **Catalog → Taxable categories**, and configure
payouts under **Business account → Payouts → Payout settings**. Create live keys
and a frontend client token under **Developer tools → Authentication**, plus
live webhook destinations under **Developer tools → Notifications**. Replace
sandbox catalogue IDs and credentials in the app. Sandbox IDs do not identify
live products. The connector does not copy catalogues on deployment or inspect
legal pages, and never labels a connected key “ready to accept payments.”
[Go-live guide](https://developer.paddle.com/build/go-live-checklist/).

## Automation and application ownership

The documented initial key setup is through the dashboard. This research has
not established an API that creates the initial merchant account or API key.
The [public API reference](https://developer.paddle.com/api-reference/) does not
establish a supported merchant-provisioning path for this connector. Create the
merchant through the provider signup flow above; do not substitute the customer
or business creation endpoints. Any partner-only onboarding would require a
separate documented provider agreement and implementation. It is not a hidden
requirement for this project's runtime or export.
Paddle documents automatic key rotation through AWS Secrets Manager for keys
created with the Rotatable option; this fragment does not provision that
integration. [Rotation workflow](https://developer.paddle.com/api-reference/about/rotate-api-keys).

An AI can prepare configuration and runtime wiring after credential bootstrap.
The merchant owner still handles account access, verification and activation.
Sandbox/live is a testing/production choice, not a free/paid quota partition.
Separate keys in one merchant account do not establish separate account limits
or balances. The application owner supplies credentials for its intended merchant
account; the editor does not supply a merchant account or shared capacity.


## Assistant permissions and payment workflow ownership

The provider declares the captured enable, recommendation, product/price,
batch-product, go-live, read/write and webhook-edit permission controls.
`products.list` maps to `api.read`. In assistant execution mode the connection
service enforces its configured ask/always/never policy before invocation.
The host must bind an approval to the authenticated caller and exact arguments;
a policy cannot grant missing Paddle permissions.

For host-owned actions, use `authorizeAssistantAction` with the declared action
and exact input before executing the host's implementation. This method only
authorizes; it does not create a merchant, product, price, payment or webhook.
The adapter supplies product listing, product creation, price creation and
existing webhook-destination updates.
The [catalogue recipe](../patterns/paddle-catalogue/PATTERN.md) composes
product-with-price and batch workflows with a partial-success report. Domain
approval can be read explicitly; full go-live readiness and arbitrary read/write
actions remain outstanding and must not be advertised as executable merely because
permission controls exist. No unrestricted API URL or write proxy is exposed.
JSKIT owns the JavaScript configuration/runtime contract; Laravel applications
use their own Paddle SDK and authorization implementation. Vibe64 edits the
project configuration and does not become the merchant account owner.

## Full application payments

This connector's operations are only part of a billing implementation. For
checkout, subscriptions, feature access, renewal credits and durable catalogue
mappings, read [payments-core](../../payments-core/README.md) and its
[standalone composition guide](../../payments-core/docs/standalone.md). These
JavaScript libraries work from ordinary app code or a CLI without Vibe64 or
Genesis. Other frameworks consume the [portable contract](../../payments-core/docs/contract.md)
and its static examples using their own runtime libraries. Keep provider setup
from this guide; do not substitute a successful connection check for working
checkout, verified webhooks or merchant approval.
