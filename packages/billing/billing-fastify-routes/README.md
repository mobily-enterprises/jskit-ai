# @jskit-ai/billing-fastify-routes

Fastify HTTP adapter for billing endpoints.

## What this package is for

Use this package to expose billing operations as HTTP APIs.

It translates incoming requests into billing-service calls for tasks like:

- listing plans/products
- starting checkout
- plan changes/cancellations
- portal links and payment links
- provider webhook intake (Stripe/Paddle)

## Key terms (plain language)

- `checkout`: the flow where a customer confirms payment/subscription.
- `webhook`: provider-to-server event callback (for example, payment succeeded).
- `plan`: recurring subscription tier (Starter, Pro, Enterprise).
- `idempotency`: safety rule that duplicate requests should not create duplicate billing effects.

## Public API

## `createController(deps)`

Creates HTTP handlers. Returned handlers:

- `listPlans`
  - Returns available plans.
  - Real example: pricing page load.
- `listProducts`
  - Returns one-time or catalog products.
  - Real example: add-on credits table.
- `listPurchases`
  - Returns purchase history.
  - Real example: billing history tab.
- `getPlanState`
  - Returns active plan/subscription state.
  - Real example: workspace settings shows current tier and renewal date.
- `listPaymentMethods`
  - Lists saved cards/payment methods.
  - Real example: billing settings card list.
- `syncPaymentMethods`
  - Refreshes local payment methods from provider.
  - Real example: user added card in provider portal, app pulls latest.
- `getLimitations`
  - Returns effective usage limits from plan.
  - Real example: show "10 projects remaining".
- `getTimeline`
  - Returns billing event timeline.
  - Real example: support/audit timeline of invoice and plan events.
- `startCheckout`
  - Starts checkout session.
  - Real example: user upgrades from Free to Pro.
- `requestPlanChange`
  - Requests upgrade/downgrade.
  - Real example: schedule downgrade at period end.
- `cancelPendingPlanChange`
  - Removes pending change request.
  - Real example: user changed their mind before effective date.
- `createPortalSession`
  - Creates provider portal session URL.
  - Real example: "Manage billing in Stripe portal" button.
- `createPaymentLink`
  - Creates direct payment link.
  - Real example: sales sends one-off payment URL.
- `processStripeWebhook`
  - Ingests Stripe webhook payload.
  - Real example: `checkout.session.completed` event updates subscription state.
- `processPaddleWebhook`
  - Ingests Paddle webhook payload.
  - Real example: Paddle subscription cancellation event.

## `buildRoutes(controller, options)`

Builds Fastify route definitions for billing endpoints.

Real example: server startup registers all billing routes in one call.

## `schema`

Exports schemas for request/response validation.

Real example: malformed checkout payload is rejected before it reaches billing logic.

## How apps use this package (and why)

Typical flow:

1. App initializes billing service and provider clients.
2. App creates adapter controller.
3. Routes are registered via `buildRoutes`.
4. UI and webhook traffic both hit these handlers.

Why apps use it:

- stable API contract across apps
- clean separation between HTTP details and billing rules
