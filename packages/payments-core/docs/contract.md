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

A trusted app can grant top-up or promotional usage units with `grantCredits`:
positive integer `units`, stable business `reference`, and either an explicit
millisecond expiry or `null` for no expiry. This call does not collect money or
prove payment. Only call it after the app's own verified funding/business event.

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
