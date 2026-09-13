# Application-owned payments

`@jskit-ai/payments-core` supplies JavaScript libraries for a generated or
hand-written Node application. No editor, hosted platform or coding assistant
is required to run them. PHP applications implement the same documented
contract using their own framework; they do not install this runtime.

Current implementation: a strict payment declaration, transactional Knex
storage, subscription feature checks, usage credits, official-SDK Stripe and
Paddle webhook verification, subscription reconciliation, checkout and customer
portal adapters, and an explicitly authorized checkout composition service.
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
- `@jskit-ai/payments-core/server/storage`: `createKnexPaymentStore({ knex })`.
- `@jskit-ai/payments-core/server`: `createPaymentService({ store, configuration, clock })`.
- `@jskit-ai/payments-core/server/stripe`: `createStripePaymentAdapter(options)`.
- `@jskit-ai/payments-core/server/paddle`: `createPaddlePaymentAdapter(options)`.
- `@jskit-ai/payments-core/server/checkout`: `createPaymentCheckoutService(options)`.

The app authorizes billing identities and mounts its own routes. A billable
subject may be a user or an organization. Never derive that subject from an
untrusted customer ID or webhook metadata. The checkout service requires an
`authorize(actor, { subjectId, action })` function that returns exactly `true`.
The app must distinguish `account`, `history`, `checkout`, `portal` and
administrator-only `reconcile`. `history` reads customer-scoped subscriptions
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
5. Create the checkout service with `adapter`, `store`, `payments`,
   `merchantScope`, `returnUrl`, and the app's `authorize` function.
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
writes and explicit recovery. SQLite fixtures do not establish PostgreSQL/MySQL
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
used by the application. Configure Paddle for `transaction.completed` and
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
