# Application-owned payments

`@jskit-ai/payments-core` supplies JavaScript libraries for a generated or
hand-written Node application. No editor, hosted platform or coding assistant
is required to run them. PHP applications implement the same documented
contract using their own framework; they do not install this runtime.

Current implementation: a strict payment declaration, transactional Knex
storage, subscription feature checks, usage credits, prepaid top-ups (one-off
Stripe Checkout payments credited once to the application's own balance),
official-SDK Stripe and Paddle webhook verification, subscription
reconciliation, checkout and customer portal adapters, and an explicitly
authorized checkout composition service.
Reviewed catalogue publication preserves environment-bound product/price IDs and
records ambiguous provider writes for recovery. Editor execution wiring and
automatic merchant onboarding remain separate unfinished work.

## Ownership and installation

The application installs this package and its selected Knex database driver,
loads `integrations.json`, resolves referenced Env values server-side and runs
the package's `migrations` through normal JSKIT migration discovery. The package
never prepares a database itself. Its tables contain application runtime data;
they are not an editor configuration database.

Public API imports:

- `@jskit-ai/payments-core/shared`: `validatePaymentConfiguration(document)`.
- `@jskit-ai/payments-core/shared/topUps`: `TOP_UP_RETURN_PARAMETER`
  (`"paymentTopUp"`), the return URL's query parameter naming the top-up a
  person comes back from.
- `@jskit-ai/payments-core/server/storage`: `PaymentStoreFeature`, the payment
  tables' one owner: registered in the server providers, it owns them through
  `runtime.resources` and provides the payment store as `payments.store`. A
  script or CLI starts it in a capability runtime of its own
  ([standalone setup](docs/standalone.md#payments-from-a-script-or-cli)).
- `@jskit-ai/payments-core/server`: `createPaymentService({ store, configuration, clock })`.
- `@jskit-ai/payments-core/server/stripe`: `createStripePaymentAdapter(options)`.
- `@jskit-ai/payments-core/server/paddle`: `createPaddlePaymentAdapter(options)`.
- `@jskit-ai/payments-core/server/checkout`: `createPaymentCheckoutService(options)`.

The app authorizes billing identities and mounts its own routes. A billable
subject may be a user or an organization. Never derive that subject from an
untrusted customer ID or webhook metadata. The checkout service requires an
`authorize(actor, { subjectId, action })` function that returns exactly `true`.
The app must distinguish `account`, `history`, `checkout`, `portal`, `topUp`
and administrator-only `reconcile`. `history` reads customer-scoped subscriptions
and invoice/transaction pages with no provider writes; its contract and CLI
composition are in [standalone setup](docs/standalone.md#provider-billing-history-from-an-app-or-cli).
Core grant/debit/reconciliation methods are trusted server APIs, not public
routes. The app authorizes them before calling them.

See [the portable contract](docs/contract.md) for file semantics and framework
requirements. [Configuration schema](contracts/configuration.schema.json) is
ordinary draft-07 JSON Schema and contains no executable JavaScript.
The [conformance guide](docs/conformance.md) supplies static JSON examples and
expected account outcomes for native-framework implementations and CLI users.

For concrete file loading, Env resolution and provider composition, see
[standalone setup](docs/standalone.md).

## First composition

1. Validate the complete integration document with the connector validator,
   then validate its `extensions.payments` with this package.
2. Select the environment on the server. Obtain its integration ID, provider
   account ID, API-key Env reference, signing secret and return URL. Do not
   accept environment, merchant ID or credentials from a browser.
3. Create the store with the app's transactional Knex client and create the
   payment service with the validated configuration.
4. Load the environment's durable logical-plan-to-provider-price bindings.
   Create one Stripe or Paddle adapter using `apiKey`, `webhookSecret`,
   `environment`, `providerAccountId` (Stripe), `taxCategory` (Paddle), and `priceBindings`. Account
   identity in this configuration is not a claim of provider verification.
   The Stripe adapter also takes `appEnv` (`appEnvironment(env)`), and refuses
   a live key (`sk_live_`, `rk_live_`) unless it is `production`
   (`payment_live_key_refused`); test keys work everywhere. Development and
   tests may point it at a stand-in for Stripe's API with `apiBaseUrl` (an
   origin such as `http://127.0.0.1:12111`), which other environments refuse.
5. Create the checkout service with `adapter`, `store`, `payments`,
   `merchantScope`, `returnUrl`, `appEnv` and the app's `authorize` function,
   plus `topUps: { offer: configuration.topUps, credit }` when it sells top-ups
   ([Prepaid top-ups](#prepaid-top-ups)).
6. Authenticated app routes call `checkout({actor, subjectId, email, planId,
   requestId})` or `portal({actor, subjectId})`. Keep the returned checkout
   request ID stable on transport retries; begin a new request for an expired
   checkout session. The library returns provider URLs to navigate to.
7. The webhook route passes a raw `Buffer` and the provider signature header
   to `webhook({rawBody, signature})`. Do not parse and reserialize its body.
   Return success only after completion; preserve failure/retry visibility.
8. Protect app actions with `requireFeature(scope, feature)` and, where
   applicable, `debitCredits(scope, {reference, units})`. For a failed job,
   `refundDebit(scope, {debitReference})` restores its unexpired allocation once.

`merchantScope` has `applicationId`, `integrationId`, `providerAccountId`,
`environment`. Account methods additionally require `subjectId`. All are
server-owned values. CLI scripts call these same libraries with trusted scope.

Paddle's return URL is an approved app-owned checkout page that initializes
Paddle.js using a **public client token** and opens the transaction supplied in
the checkout URL. It is not just a generic success page. Stripe uses hosted
Checkout and a return page. Both providers' customer portals remain provider
hosted. Provider account registration and Paddle domain approval are separate
setup tasks; a successful API request does not prove approval.

## Prepaid top-ups

A configuration with `topUps` (see [the contract](docs/contract.md#prepaid-top-ups))
sells one-off Stripe Checkout payments of an amount the person chooses within
its limits, credited once to the application's own balance:

```js
const checkout = createPaymentCheckoutService({
  adapter, store, payments, merchantScope, returnUrl, authorize, appEnv: appEnvironment(env),
  topUps: {
    offer: configuration.topUps,
    // Inside the transaction that marks the top-up paid; write with `options` so both commit or neither does.
    credit: ({ reference, subjectId, amount, currency }, options) => balances.add({ reference, subjectId, amount, currency }, options)
  }
});
```

The checkout service then has:

- `topUp({actor, subjectId, amount, requestId, email?, description?})`:
  authorizes action `topUp`, checks the amount (an integer in the currency's
  smallest unit, within `minimumAmount`..`maximumAmount`), writes the top-up
  down and opens its Checkout payment. Answers
  `{topUpId, status, amount, currency, url}`; navigate to `url` (in a framed
  page, `@jskit-ai/payments-web`'s `openPaymentPage(url)` opens it in a new
  tab). The same `requestId` answers the same top-up.
- `confirmTopUp({actor, subjectId, topUpId})`: the return page's call, with the
  `paymentTopUp` query parameter Checkout returns with. It authorizes action
  `topUp`, reads the session from Stripe with the server's key and settles it.
  Answers the same shape plus `credited`, true only for the call that credited.
- `webhook({rawBody, signature})` settles the top-ups' Checkout events
  (`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`) through
  the same path, before subscription events.

`credit` is called once per paid top-up with a stable `reference`
(`top-up:<topUpId>`), the subject the top-up was written down for, the amount
and the currency, and the options of the transaction that settles it. Its
handle calls take those options (spread under the application's own context
where it needs one) and join that transaction. It runs again only after its
transaction rolled back, so it writes nothing outside it; a balance kept
elsewhere must be idempotent on the reference. Composing top-ups with a Paddle
adapter, or without `offer` or `credit`, throws a TypeError naming the fix; a
service composed without them answers `topUp` with `payment_top_ups_unavailable`.

## Failures and evidence

Checkout writes an intent before contacting the provider. A crash or ambiguous
failure leaves it pending and prevents another write. The administrator invokes
`reconcilePending` with a trusted server inspection function that checks provider
activity and returns the recovered result or `confirmedNotCreated: true`.
Neither a browser assertion nor a blind retry is evidence. The callback must not
be exposed as user-supplied executable code. Recovery does not require platform
access: an ordinary authorized application CLI can invoke it.

Official SDKs own signature verification. Normal subscription reconciliation
fetches current provider facts while holding the account transaction lock; old
event payloads cannot resurrect canceled subscriptions. Provider failures roll
back receipts and grants. Keep this path bounded by application request timeouts.
The package deliberately handles a single recurring price, quantity one, per
subscription; unsupported shapes fail visibly rather than granting guessed
features or allowances.

Focused fixture evidence currently covers raw signatures with both official
SDKs, storage rollback, duplicate grants/renewals, subject/environment isolation,
concurrent debit requests, expired refunds, checkout authorization, uncertain
writes and explicit recovery. Top-ups are tested through the real Stripe SDK
against a stand-in for Stripe's API (`test/support/fakeStripe.js`): checkout
creation and authorization, limits, each webhook outcome, the return page's
confirmation, foreign and tampered sessions, a failing credit, and live-key and
stand-in refusals; `test/topUps.mysql.test.js` races the webhook and the return
page over one payment on MariaDB and sees it credited once. SQLite fixtures do not establish PostgreSQL/MySQL
multi-process locking behavior. Live provider accounts and full generated-app
acceptance have not been exercised.


Catalogue operations are exported from `./server/catalogue` as
`createPaymentCatalogue({store, adapter, scope, configuration})`. `preview()`
returns proposed changes, provider drift and a review ID. `publish({reviewId})`
rechecks that review before writes; partial completion and a pending request
remain durable. `recover` requires an authorized server administrator to inspect
a provider object or explicitly establish that the request did not create one.
Never wire that assertion directly to an untrusted client. Old price mappings
remain in catalogue history. Pass current plan-to-price mappings as
`priceBindings` and historical price-to-plan mappings as `historicalPriceBindings`
when constructing payment adapters. A removed plan needs explicit handling for
existing subscribers; publication does not cancel their subscriptions.

### Webhook event selection

Configure Stripe deliveries for `invoice.paid`, `invoice.payment_failed`,
`invoice.payment_action_required`, and the `customer.subscription.*` lifecycle
used by the application, and, for top-ups, `checkout.session.completed`,
`checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed` and `checkout.session.expired`. Configure Paddle for `transaction.completed` and
`subscription.*` lifecycle deliveries. The provider adapter selects relevant
subscription events only after signature verification; signed standalone
invoices/transactions are ignored before application customer lookup.

Stripe invoice payloads must use the SDK-supported `parent.subscription_details`
shape. An absent parent field is a configuration/version error, rather than a
successful ignored delivery. An explicit null parent denotes a standalone
invoice. Paddle uses the SDK-normalized `subscriptionId` for completed
transactions. Configure webhook versions consistently with the installed SDK.

Reconciliation fetches current provider state instead of trusting event order.
Failed-payment notifications update subscription state without awarding unpaid
renewal credits. A delayed notification received after payment recovery can
reconcile the now-paid invoice; its invoice identity still deduplicates the
credit grant. Monetary refund and dispute clawbacks remain unimplemented.
