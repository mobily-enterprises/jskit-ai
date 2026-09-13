# Stripe

Import `stripeProvider` from `@jskit-ai/connectors-catalog/server/stripe`.
The initial fragment reads a merchant account's balance. It does not implement
checkout, subscriptions, refunds, webhooks or Stripe Connect onboarding.

## Configure access

Before creating a key, [create or sign into your own Stripe account](https://dashboard.stripe.com/register).
Select the business that will receive this application's payments. Complete
Stripe's requested activation information in its Dashboard before accepting live
payments. Saving a key does not create, activate or approve a merchant account.
Keep sandbox and live credentials separate.

1. Select the intended Stripe account and sandbox/live mode in the Dashboard.
   Open **API keys**, then **Create restricted key**.
2. Start with zero permissions, give the key an application-specific name and
   grant **Balance** read access. Leave unrelated resources disabled.
3. Choose **Create key**, complete the verification prompt and copy the value
   while visible. Finish the note/save dialog. These controls and the option
   to duplicate a key are described in the
   [restricted-key guide](https://docs.stripe.com/keys/restricted-api-keys).
4. Put the value in backend Env as `STRIPE_API_KEY`. Save provider `stripe`,
   mode `shared` or `assistant`, `scopes: []`, and authentication
   `{ "method": "api-key", "secretRef": "env:STRIPE_API_KEY" }`.
5. Run `connectApiKey` to verify balance access. Publishable keys are unsuitable;
   restricted and secret keys authenticate backend requests. Bearer auth is
   supported alongside Basic auth.
   [Authentication](https://docs.stripe.com/api/authentication).

## Runtime and AI composition

`balance.read` performs `GET https://api.stripe.com/v1/balance` with no input.
The returned object retains `available`, `pending`, currency amounts and
`livemode`. It uses the account's configured Stripe API version; no version
override or connected-account header is supplied by this fragment.
[Balance endpoint](https://docs.stripe.com/api/balance/balance_retrieve).

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with this
provider. The CLI and editor use identical JSON and file-store library wiring.
Applications must authorize who can see the shared merchant account's balance.

## Automation and application ownership

An AI can author the configuration and balance call after the owner supplies a
key. This pass establishes Dashboard key creation, not an API for bootstrapping
the merchant account or issuing its initial restricted key. Account activation
and any requested business verification remain owner tasks.

The application owner supplies a key for its merchant account through private
Env. Separate keys do not create separate merchants or prove separate capacity.
An application serving multiple merchants needs explicit merchant ownership and
its own Stripe Connect design; it cannot silently collect each merchant's revenue
into one unrelated account. That design is outside this balance fragment.

Automatic merchant onboarding uses Stripe Connect, a separate platform
integration with explicit account responsibilities and Dashboard access. It is
not provided by entering this project's API key. See Stripe's current
[connected-account configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration).
This connector does not create connected accounts or depend on a platform's
Connect credentials. Exported applications continue using their own merchant
credentials and application database.

Automated tests cover balance shape, headers, file-store restart, credential
replacement, isolation, disconnect and errors. They make no live Stripe calls.

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
