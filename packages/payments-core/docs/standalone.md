# Set up payments without an editor

A hand-written JSKIT application uses exactly the same payment declaration as an
application configured through an editor. The application reads the file; the
library receives the parsed configuration. There is no editor discovery, remote
configuration lookup, or dependency on an editor session.

Install `@jskit-ai/payments-core` and `@jskit-ai/connectors-core` alongside the
application's existing Knex integration and selected database driver. These
packages are currently worktree implementations: registry installation must wait
for the coordinated release. Run the payment package migrations through the
application's normal migration discovery before starting billing routes.

## Prepare provider access

Create an application-owned merchant account and key using the
[Stripe setup guide](../../connectors-catalog/docs/stripe.md) or
[Paddle setup guide](../../connectors-catalog/docs/paddle.md). The basic connector
check reads only balances or products; it does not verify billing permissions.

For the current Stripe payment adapter, the key must allow account and balance
reads, invoice and subscription reads, customer/product/price writes, and Checkout
and customer portal session creation. These correspond to the SDK calls in
`src/server/stripe.js`; grant only the resource permissions used by the app.
Stripe's [restricted-key guide](https://docs.stripe.com/keys/restricted-api-keys)
explains how to create/edit a key and inspect failed request logs. Connected-account
permissions are unnecessary for this app-owned merchant flow. Configure the
customer portal in Stripe's Billing settings separately.

For Paddle, enable `product.read`, `product.write`, `price.read`, `price.write`,
`customer.write`, `transaction.read`, `transaction.write`, `subscription.read`
and `customer_portal_session.write` for the current complete billing composition.
See the [permission reference](https://developer.paddle.com/api-reference/about/permissions/).
Notification destination editing additionally requires `notification_setting.write`;
domain approval lookup requires `checkout_domain.read`. Those connector operations
are separate from receiving and verifying webhooks.

For each environment, create a webhook destination pointing at the app's own
receiver and save its signing secret in the configured Env reference. Use the
[event selection instructions](../README.md#webhook-event-selection). A provider
API key is not a webhook signing secret. Keep sandbox and live credentials,
destinations and catalogue mappings separate. No live permission check or merchant
approval is inferred from the package's controlled tests.

## Declare the application's plans

Add this payment extension to the application's integration document. `billing`
refers to a shared Stripe integration whose API key is an Env reference. The
merchant account ID below is illustrative; replace it with the actual account.
Keep the complete integration document valid under the connector schema too.

```json
{
  "version": 1,
  "environments": {
    "sandbox": {
      "integrationId": "billing",
      "providerAccountId": "acct_replace_me",
      "webhookSecretRef": "env:STRIPE_WEBHOOK_SECRET",
      "returnUrlRef": "env:BILLING_RETURN_URL"
    }
  },
  "plans": {
    "pro": {
      "name": "Pro",
      "amount": 1200,
      "currency": "USD",
      "interval": "month",
      "features": ["export"],
      "renewalCredits": 100
    }
  }
}
```

Save that object at `extensions.payments` in `integrations.json`. Keep the
provider API key in the environment named by
`integrations.billing.authentication.secretRef`. Set the signing secret and
return URL through the application's normal environment mechanism. Missing
values, including the placeholder `MISSING`, must fail setup visibly.

## Compose the server libraries

This is application startup code. `knex`, `authorizeBilling`, `applicationId`,
`environment` and `configurationUrl` are supplied by the application's existing
server composition. Select them on the server. `applicationId` is a durable
application identity, not its current domain. The environment is explicitly
`sandbox` or `live`; do not silently fall back between them.

```js
import { readFile } from 'node:fs/promises';
import { createEnvironmentReferenceResolver } from '@jskit-ai/connectors-core/server';
import { validatePaymentConfiguration } from '@jskit-ai/payments-core/shared';
import { createKnexPaymentStore } from '@jskit-ai/payments-core/server/storage';
import { createPaymentService } from '@jskit-ai/payments-core/server';
import { createStripePaymentAdapter } from '@jskit-ai/payments-core/server/stripe';
import { createPaymentCheckoutService } from '@jskit-ai/payments-core/server/checkout';
import { createPaymentCatalogue } from '@jskit-ai/payments-core/server/catalogue';

const document = JSON.parse(await readFile(configurationUrl, 'utf8'));
// Also run the application's complete connector validation with its provider list.
const configuration = validatePaymentConfiguration(document);
if (!Object.hasOwn(configuration.environments, environment)) {
  throw new Error('Configure the selected payment environment first.');
}
const binding = configuration.environments[environment];
const integration = document.integrations[binding.integrationId];
if (integration.provider !== 'stripe') throw new Error('This composition selects Stripe.');
const resolve = createEnvironmentReferenceResolver(process.env);
const apiKey = await resolve(integration.authentication.secretRef);
const webhookSecret = await resolve(binding.webhookSecretRef);
const returnUrl = await resolve(binding.returnUrlRef);
const merchantScope = {
  applicationId, integrationId: binding.integrationId,
  providerAccountId: binding.providerAccountId, environment
};
const store = createKnexPaymentStore({ knex });
const payments = createPaymentService({ store, configuration });
const published = await store.inspectCatalogue(merchantScope);
const priceBindings = Object.fromEntries(Object.entries(published.plans)
  .filter(([planId, plan]) => Object.hasOwn(configuration.plans, planId) && plan.priceId)
  .map(([planId, plan]) => [planId, plan.priceId]));
const historicalPriceBindings = Object.fromEntries(published.history
  .map((plan) => [plan.priceId, plan.planId]));
const adapter = createStripePaymentAdapter({
  apiKey, webhookSecret, environment, providerAccountId: binding.providerAccountId,
  priceBindings, historicalPriceBindings
});
const catalogue = createPaymentCatalogue({ store, adapter, scope: merchantScope, configuration });
const checkout = createPaymentCheckoutService({
  adapter, store, payments, merchantScope, returnUrl, authorize: authorizeBilling
});
```

The returned objects stay inside the backend. Never serialize the environment,
adapter or secret-bearing startup variables to the client. `authorizeBilling`
must return exactly `true` only for an actor allowed to manage the requested
billable subject and action. A subject can be a workspace or user; the app owns
that decision and obtains its ID from authenticated membership, not request
claims alone.

An authorized administrator first calls `catalogue.preview()`, reviews its
changes and calls `catalogue.publish({reviewId})`. An ordinary application CLI
can do this. Configuration reads never publish anything. After successful
publication, rebuild this composition from the current bindings (or restart the
app) before accepting checkout requests. An empty catalogue cannot sell a plan.

Map authenticated checkout and portal routes to the corresponding `checkout`
methods. Map the webhook route to `checkout.webhook({rawBody, signature})`,
preserving the unmodified request Buffer. Enforce features using
`payments.requireFeature({...merchantScope, subjectId}, 'export')`; debit credits
using a stable business-operation reference. A successful checkout redirect is
not proof of payment: verified provider reconciliation updates access and credits.

## Paddle composition

Use `createPaddlePaymentAdapter` from `@jskit-ai/payments-core/server/paddle`
with the same store, services and mappings, plus the binding's explicit
`taxCategory`. The selected Paddle integration's environment must match the
payment environment. Resolve `publicClientTokenRef` separately and supply only
that public client token to the app's Paddle.js checkout page. Never supply its
API key or signing secret to the browser. The return URL must be the approved
application checkout page described in the package README. Merchant approval
and checkout-domain approval remain provider setup steps.

## Changes and portability

Editing the JSON file manually changes the same configuration the editor would
change. Restart/reload the application composition deliberately after validation;
the library does not watch files. Price changes need a reviewed catalogue publish.
Keep old plans available until existing subscribers have an explicit migration
policy; removing a plan does not cancel subscriptions or invent replacement access.

Move the source, environment bindings and application database together when
changing hosts. Back up customer mappings, publication mappings and credit
entries with the rest of the database. Domain changes require the app's return
URL and provider webhook/checkout settings to be updated; they do not change
its application identity or move ownership to an editor.

This guide describes explicit composition, not a completed automatic installer.
HTTP framework wiring and native PostgreSQL/MySQL deployment verification remain
application responsibilities; focused package tests use controlled fixtures.

## Customer-facing billing page

The optional `@jskit-ai/payments-web` package owns the reusable Vue/Vuetify
`PaymentAccount` view. Its README specifies the props, emitted actions and
existing JSKIT HTTP-hook composition. Node-only consumers do not install Vue.
`checkout.account({actor, subjectId})` authorizes action `account`, then returns
balance, features, subscriptions and a `hasCustomer` flag without provider customer
IDs or credentials. The application adds safe display plans and permission hints.
Checkout and portal calls still authorize their own actions independently.

## Provider billing history from an app or CLI

The same checkout service exposes `history({actor, subjectId, collection, after})`.
Authorize action `history` using the application's billing-read policy. An editor
owner is not automatically authorized to read a tenant's records. The service
resolves the provider customer from the scoped application database; callers
cannot select a provider customer, merchant or environment.

```js
// actor and subjectId come from the app's authenticated route or CLI policy.
const page = await checkout.history({
  actor, subjectId, collection: 'transactions', after: null
});
// Display this page; load another only on an explicit request, using nextCursor.
```

Collections are `subscriptions` and `transactions`. Each call fetches at most 20
records and returns `{collection, items, nextCursor}`. A missing customer returns
an empty page without creating one. Items expose only provider ID, kind, status,
and ISO creation time. Financial records also expose currency, `totalMinor` and
`paidMinor` as integer strings or `null` when unknown; preserve these strings
when using native decimal/money facilities. Do not convert large amounts to a
JavaScript Number.

Stripe financial history contains **invoices**, not every charge, refund or
payment attempt. Paddle contains **transactions**; its total is not a paid
amount, so `paidMinor` stays null. Draft Paddle totals may also be null. Preserve
the `kind` and status in the UI rather than labelling every row a successful
payment. Subscription history includes canceled subscriptions and is a provider
view, not the source of application entitlements. A read never grants credits.

Laravel can use its native policies and stored customer relation to call
[Stripe subscription lists](https://docs.stripe.com/api/subscriptions/list) and
[invoice lists](https://docs.stripe.com/api/invoices/list), or
[Paddle subscription lists](https://developer.paddle.com/api-reference/subscriptions/list-subscriptions/)
and [transaction lists](https://developer.paddle.com/api-reference/transactions/list-transactions/).
Apply the customer filter on every page, retain provider status, and project only
these display fields. Do not pass arbitrary pagination URLs or SDK objects to
the client. JSKIT's provider adapters are trusted server primitives; UI/CLI
entry points use the authorized service above.

This is an app/CLI library capability. The editor history command and history
screens remain separate integration work; this method does not add them by itself.

## Read-only readiness inspection

Compose `createPaymentReadiness` from
`@jskit-ai/payments-core/server/readiness` with `{adapter, catalogue,
scope: merchantScope}`. Its `inspect()` reports separate credential, account,
charges, payouts, catalogue, webhook, checkout, site and deployment checks. No
provider writes occur. Scope mismatches fail, provider exceptions are replaced
with safe diagnostics, and unknown/manual checks remain explicit.

An optional app-owned `inspectApplication` callback may supply `webhook`,
`checkout`, `site` and `deployment` evidence as `{status, detail}` records. Use
`passed`, `failed`, `unknown` or `manual` and a safe explanation of at most 500
characters. Record only observed checks. Never turn an unavailable check into
success or claim provider approval from a fixture. This callback is a normal app
function, not a Vibe64 API. Authorize any route/CLI wrapper exposing the service.

Catalogue recovery requires a fresh `catalogue.preview()` and its `reviewId`:
`catalogue.recover({reviewId, providerId})`. The adapter reads the candidate object;
its ID and pending operation must match, and a recovered price must be active.
A stale review is rejected. Trusted administrator code may instead supply
`confirmedNotCreated: true` with that review only after actual provider inspection
establishes absence. Do not expose that assertion as an ordinary browser flag.
