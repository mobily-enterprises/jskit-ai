# Portable payment contract v1

The application owns this contract and its runtime data. A UI and a CLI edit the
same `integrations.json` declaration at `extensions.payments`. Its normative
structural definition is `../contracts/configuration.schema.json`, shipped as
`@jskit-ai/payments-core/configuration.schema.json`. Any JSON Schema draft-07
validator can consume it. Cross-reference constraints below supplement it.

Example extension (inside the ordinary integrations document):

```json
{
  "payments": {
    "version": 1,
    "environments": {
      "sandbox": {
        "integrationId": "billing",
        "providerAccountId": "acct_replace_with_your_account",
        "webhookSecretRef": "env:PAYMENT_WEBHOOK_SECRET",
        "returnUrlRef": "env:PAYMENT_RETURN_URL"
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
}
```

Each integration reference must select a shared Stripe/Paddle API-key slot
using an Env reference. Paddle's connector environment must equal the payment
environment. Paddle also requires `taxCategory` and `publicClientTokenRef`
(an Env reference to its public frontend token). Each environment has its own merchant, signing secret and price
bindings. The same source declaration can name both environments, but callers
cannot select live operations merely by submitting `environment: live`.
The server owns environment selection and supplies the matching Env projection.

Only production takes real money. The application's `APP_ENV` decides: in
development, test and staging, checkout and billing-portal requests in the live
payment environment are refused with `payment_sandbox_only` (409), before any
provider write; the sandbox environment works everywhere. Pass
`appEnv: appEnvironment(env)` to `createPaymentCheckoutService`.

A live Stripe key (`sk_live_`, `rk_live_`) is refused outside production as
well: `createStripePaymentAdapter` takes `appEnv` and throws
`payment_live_key_refused` (409) unless it is `production`. Test keys work in
every environment. Its `apiBaseUrl`, a stand-in for Stripe's API so that tests
never reach Stripe, is taken only in `development` and `test`
(`payment_stand_in_refused`, 409, elsewhere).

An amount is an integer in the currency's smallest unit. ISO-looking currency
syntax is not evidence the provider accepts that currency. Initial plans are
one recurring item, quantity one, monthly or yearly. Logical plan IDs are source
identities; external product and price IDs are environment/account-bound runtime
mappings. Publishing those mappings must preserve historical prices referenced
by existing subscriptions. Never infer a mapping from display names or assign
a browser-supplied provider price to a plan.

## Access and credits

A subscription grants its plan's named features only while its current fetched
status is `active` and its period end is in the future. Trials, past-due, unpaid,
paused, incomplete, expired and canceled subscriptions grant no features in v1.
Cancel-at-period-end remains active until the provider ends the subscription.
The app may deliberately add its own trial/free-feature policy outside this
paid entitlement check; it must not silently reinterpret these states.

An initial paid subscription period or ordinary paid renewal grants the plan's
`renewalCredits` once, keyed by the provider invoice/transaction, not delivery
ID. Zero means no grant. Proration/update events do not grant a fresh allowance.
Renewal credits expire at the paid period end and never roll over. Late delivery
may record already-expired credits; it must not give a new period accidentally.
Cancellation removes feature access but does not revoke an existing credit lot
before its recorded expiry. Monetary refunds/chargebacks do not yet implement
automatic credit clawback: that remains explicit application reconciliation.

## Prepaid top-ups

`topUps`, beside `plans`, lets a person pay a one-off amount they choose into the
application's own balance:

```json
"topUps": { "name": "Credits", "currency": "USD", "minimumAmount": 100, "maximumAmount": 50000 }
```

`name` is the product line on the payment page. Amounts are integers in the
currency's smallest unit; Stripe takes nothing below 50, and `minimumAmount`
must not exceed `maximumAmount`. A configuration sells plans, top-ups or both:
`plans` may be empty only when `topUps` is present. Top-ups are one-off Stripe
Checkout payments: an environment bound to a Paddle connection fails validation
at its `integrationId` with `payments.configuration.paddleTopUps`.

A top-up is written down before the provider hears of it, for the billable
subject the application authorized (action `topUp`) and the amount it chose
within the limits (`payment_top_up_amount_invalid`, 422, outside them). One
request ID is one top-up: a repeated request answers it, and the same request
ID with another amount is `payment_reference_conflict`. Its Checkout payment
comes back to the application's return URL with `?paymentTopUp=<topUpId>`,
paid or not. That parameter only names the top-up; it is never evidence.

Two doors settle a top-up, and both take one path. The verified webhook carries
the provider's signed facts; the return page asks the server to confirm, and the
server reads the Checkout session from the provider with its own key. Neither
door names a subject: the top-up written down at checkout is the authority, and
an event for a session not made for one of this merchant's top-ups is
acknowledged and ignored. Under the top-up's row lock the reported outcome moves
its status (`open`, `processing` for a bank payment that has not cleared, then
`paid`, `failed` or `expired`); paid wins over every other status, and failed or
expired never undo a payment. Only the move to `paid` credits, by calling the
application's credit function inside the same database transaction, with a
stable reference `top-up:<topUpId>`, the amount and the currency, after checking
that the provider took exactly the top-up's amount and currency. Whichever door
comes second finds the top-up paid and credits nothing. A credit that fails
rolls the settlement back, and the next report credits it.

The application's balance is its own: a balance in its database writes the
credit through the transaction options it is given, so the credit and the
settlement commit together; a balance kept elsewhere must stay idempotent on the
reference, since the call can run again after a rolled-back attempt.

A trusted app can grant promotional or other usage units with `grantCredits`:
positive integer `units`, stable business `reference`, and either an explicit
millisecond expiry or `null` for no expiry. This call does not collect money or
prove payment. Only call it after the app's own verified funding/business event,
such as a top-up's credit call. It commits in a transaction of its own, once per
reference, so a credit function that grants through it is idempotent on the
top-up's reference but not atomic with the settlement; on a database with one
connection (SQLite in tests) it would wait for the settlement's own.

Debits consume the soonest-expiring valid lot first and cannot create a negative
balance. A stable reference denotes one business action. Reusing it with a
different quantity fails. Full debit refunds happen once per debit, return
units only to still-valid lots, and report the amount already expired. Partial
refunds, monetary balances and transferable credits are outside v1 semantics.

Provider event receipts, subscription changes and allowance grants commit in
one transaction. Customer binding is unique within application, integration,
merchant and environment. Different delivery IDs for the same paid invoice
cannot produce another grant. Reconciliation loads current provider state;
provider event timestamps alone are insufficient ordering evidence.

## Framework implementation contract

Laravel uses its own authentication, policies, ORM/migrations, transaction and
row-locking APIs, provider PHP SDKs, routes and browser components. No PHP belongs
in this JavaScript package and no Node sidecar is required. A framework adapter
must preserve these observable behaviors:

| Operation | Required authority and outcome |
|---|---|
| Inspect account | Authenticated access to the billable subject; balance, features, subscriptions; no remote mutation |
| Billing history | Explicit billing-read policy for the subject; app-resolved customer, one filtered provider page, bounded display fields; no grant or mutation |
| Checkout | Billing-management policy, configured logical plan, trusted contact email and stable request ID; provider URL |
| Top up | `topUp` policy for the subject, an amount within the configured limits and a stable request ID; the top-up recorded before the provider is asked; provider URL |
| Settle a top-up | Verified webhook facts or the provider's session read with the server's key; the recorded top-up's subject and amount; status and credit committed together, once |
| Portal | Billing-management policy, server-bound customer; provider URL |
| Verify webhook | Raw bytes and signing secret for the exact environment; no reliance on a browser session |
| Reconcile event | Verified event, server customer binding, fresh provider facts and atomic receipt/state/grant |
| Debit/refund | Authorized app business action, stable reference and atomic balance change |
| Resolve uncertain operation | Explicit administrator policy and provider evidence; never blind retry |

Persistence must serialize mutations to the same scoped account and uniquely
index business receipts. A missing/failed transaction cannot fall back to
unlocked writes. Store customer mappings and catalogue bindings in the app's
database, not editor state. Retain an operation intent across crashes before
performing remote creation; refuse duplicates until reconciliation resolves it.

When integrating Laravel, give its assistant this document, the JSON schema and
[portable conformance fixtures](conformance.md),
the application's chosen database and billable identity, and its configured
provider. Ask it to use the installed framework/provider APIs to implement this
contract and test the fixture scenarios in the package tests. Those scenarios
are evidence requirements, not permission to import JavaScript into PHP or a
claim that a Laravel implementation already exists. The static fixtures require
no JavaScript execution. The application's editor-command implementation must
add the invoking host's operation contract separately; this package does not
parse Stack files or implement editor authorization.

Configuration failures use `payment_configuration_invalid` (422). Field errors
identify `extensions.payments/...` paths, including cross-reference failures at
`environments/<environment>/integrationId` and missing Paddle token/tax-category
fields. Messages explain the repair without echoing credential values.

Every error keeps its English `message` and its stable `payment_*` `code`. The
English of a code used for one sentence lives under `jskit.errors.<code>` in
`locales/en.json`. Where one code covers several sentences, the error also
carries `messageCode` and `messageParams` naming a `jskit.payments.*` message,
and binding field errors carry `code` and `params`, so a JSKIT application can
show them in the user's language. Other implementations may ignore these
fields.
