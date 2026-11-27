---
title: "Recipe: payments and subscriptions"
description: Let people pay for a JSKIT app with plans, hosted checkout, a billing page and features unlocked by verified provider events, through @jskit-ai/payments-core and @jskit-ai/payments-web.
---

# Let people pay for `<APP_NAME>`: plans, subscriptions and a billing page

People choose a plan and pay on Stripe's hosted Checkout, manage or cancel
their subscription in Stripe's customer portal, and see their plan on a
billing page in `<APP_NAME>`. The app unlocks each plan's features only from
verified provider events, never from a redirect. Card details never reach the
app, and outside production only the sandbox is used.

## When to propose it

- "Charge for it", "subscriptions", "pricing plans", "a paid tier",
  "paywall", "Stripe", "Paddle".
- "Credits", "pay as you go", "top up".
- "Only paying customers can export / invite / use X".

## How to answer the person

Propose the simple way first: "People pay on Stripe's own checkout page and
manage their subscription in Stripe's portal; `<APP_NAME>` shows their plan
and unlocks its features once Stripe confirms the payment. You set up a Stripe
account and keys; we start in Stripe's test mode and only production ever
takes real money."

Then say: "There are other options if you want to discuss." They are Paddle
instead of Stripe (Paddle sells as the merchant of record and handles sales
tax), prepaid top-ups that add credit to a balance, usage credits debited per
operation, and in-app purchases in store apps, which JSKIT does not cover.

## Product decisions (defaults)

- Provider: Stripe, hosted Checkout and customer portal.
- Who pays: the workspace in an app with workspaces, else the user.
- Plans: one free level with no subscription and one paid plan, monthly, in
  one currency; each plan lists the features it unlocks and, optionally,
  credits each renewal.
- Who manages billing: the workspace owner (a permission of the app's own,
  listed in `roleCatalog.customPermissions`); any member may read the plan.
- A refused feature explains itself and links the billing page.
- Failed payments: the subscription's status comes from Stripe; features
  follow it, and the billing page says what to do.

## Make a careful saved plan first

Write a careful saved plan first, then implement it item by item, proving each
one:

1. The person creates the Stripe account, a restricted key with the
   permissions the payments-core setup guide lists, a webhook destination for
   the events it lists, and its signing secret, in test mode first.
2. Declare the plans in `integrations.json` at `extensions.payments`, with the
   `sandbox` environment's binding; keys are Env references, never values.
3. Install `@jskit-ai/payments-core` and `@jskit-ai/connectors-core` (and
   `@jskit-ai/payments-web` for the billing page), run `npm run db:migrate`,
   and register `PaymentStoreFeature`, the payment tables' one owner.
4. Compose the payment service, the Stripe adapter, the catalogue and the
   checkout service in a server feature, with the app's `authorizeBilling`.
5. Publish the catalogue once with an administrator's preview and publish.
6. Routes: account, checkout, portal and history, signed in; the webhook,
   with the request's raw bytes.
7. Gate each paid feature's actions with `requireFeature`.
8. The billing page with `PaymentAccount`, and the return page that refreshes
   from the server.
9. A pricing page and help text; the refusals' words.

## Technical details

- **Read first:** the installed `@jskit-ai/payments-core/README.md`,
  `docs/standalone.md` and `docs/contract.md`
  ([standalone setup](https://github.com/mobily-enterprises/jskit-ai/blob/main/packages/payments-core/docs/standalone.md)),
  and `@jskit-ai/payments-web/README.md`. Compose exactly what they show;
  never call Stripe's SDK from the app's own code for these flows.
- **Configuration:** `extensions.payments` in `integrations.json`, checked
  with `validatePaymentConfiguration(document)` from
  `@jskit-ai/payments-core/shared`. The provider API key lives in the
  environment named by `integrations.billing.authentication.secretRef`; the
  webhook signing secret and return URL through the binding's
  `webhookSecretRef` and `returnUrlRef`, resolved on the server with
  `createEnvironmentReferenceResolver` from `@jskit-ai/connectors-core/server`.
  A missing value fails setup visibly.
- **Storage:** `PaymentStoreFeature` from
  `@jskit-ai/payments-core/server/storage` provides `payments.store`; the
  composing feature requires it. Payment tables are the package's, migrated
  through normal discovery; the app copies none.
- **Composition:** `createPaymentService({ store, configuration })`,
  `createStripePaymentAdapter({ ..., appEnv: appEnvironment(env) })`,
  `createPaymentCatalogue({ store, adapter, scope, configuration })` and
  `createPaymentCheckoutService()` with `adapter`, `store`, `payments`,
  `merchantScope`, `returnUrl`, `authorize` and `appEnv`, as
  `docs/standalone.md` shows. A live key
  is refused outside production (`payment_live_key_refused`) and live checkout
  is refused there (`payment_sandbox_only`)
  ([Environments](/guide/framework/environments#what-jskit-does)).
- **Authorization:** `authorize(actor, { subjectId, action })` returns
  exactly `true` only for an actor allowed that action (`account`, `history`,
  `checkout`, `portal`, `topUp`, and administrator-only `reconcile`) on that
  subject, taken from the signed-in membership, never from a request's claim.
- **Catalogue:** an administrator runs `catalogue.preview()` and then
  `catalogue.publish({ reviewId })`, from a small CLI as the setup guide's
  "Payments from a script or CLI" shows; rebuild the composition after
  publishing.
- **Routes:** `auth: "required"` routes call `checkout.account`,
  `checkout.checkout`, `checkout.portal` and `checkout.history` with the
  signed-in actor; each returns provider URLs to navigate to. The webhook
  route passes the unmodified request `Buffer` to
  `checkout.webhook({ rawBody, signature })`. JSKIT's router has no raw-body
  option: register the webhook in a Fastify scope of its own (the
  `runtime.fastify` capability) whose JSON parser keeps the bytes
  (`addContentTypeParser("application/json", { parseAs: "buffer" }, ...)`),
  and answer success only after the call completes.
- **Features:** an action that needs a plan calls
  `payments.requireFeature({ ...merchantScope, subjectId }, "export")` before
  its work; credits are debited with a stable business reference. The refusal
  carries its own code, shown through `useJskitText()`'s `serverMessage()`
  ([Refusals carry their own code](/guide/framework/typed-features#refusals-carry-their-own-code)).
- **Billing page:** `PaymentAccount` from
  `@jskit-ai/payments-web/client/components/PaymentAccount`, fed by the
  account route, with display plans built on the server; it emits
  `checkout`, `portal`, `refresh` and `history`. Navigate to a returned URL
  with `openPaymentPage(url)` from
  `@jskit-ai/payments-web/client/openPaymentPage`. The return page refreshes
  from the server: a redirect is not proof of payment.
- **Top-ups**, when chosen: `topUps` in the configuration, `PaymentTopUp`, and
  `checkout.topUp` and `checkout.confirmTopUp` with the app's own
  `credit` function, as the README's "Prepaid top-ups" shows.

## Proof

Prove each behaviour at the cheapest level, never against development data
and never against Stripe itself.

- **Server tests** (`jskit test`, on `TEST_DB_NAME`): each `authorize` action
  for owner, member and another workspace; checkout refused for a subject the
  actor can't manage; `requireFeature` refusing without the plan and allowing
  with it; the webhook refusing a bad signature and a parsed (not raw) body;
  live keys refused outside production. Use a stand-in for Stripe's API
  through the adapter's `apiBaseUrl`, which only development and test accept,
  as payments-core's own tests do.
- **Client tests:** the billing page's loading, error, free, active and
  overdue states.
- **Browser tests** (`npm run test:e2e`): a refused feature leads to the
  billing page; the checkout button navigates to the URL the stubbed route
  returns; the return page refreshes the plan.

## Leftovers for the person

- The Stripe (or Paddle) account, its restricted key, webhook destination and
  signing secret, the customer portal's settings, and tax registration.
- One real test-mode payment end to end on a deployed staging app, then the
  live keys in production only.
