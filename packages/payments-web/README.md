# Application billing UI

`@jskit-ai/payments-web` supplies a Vue/Vuetify account component for generated or
hand-written JavaScript applications. It has no Vibe64, Online, Genesis, provider
SDK, credential, file-discovery or HTTP dependency. The application mounts it in
its existing billing page or semantic placement. It does not register routes or
change shell navigation automatically. This worktree package is not yet published.

## Component contract

Import `PaymentAccount` from
`@jskit-ai/payments-web/client/components/PaymentAccount`.

| Prop | Meaning |
|---|---|
| `account` | Authorized account projection: integer `balance`, `features` string array, `subscriptions` array, boolean `hasCustomer`; null until loaded |
| `plans` | Display records: `id`, `name`, `priceLabel`, `features` array, integer `renewalCredits`, boolean `available` |
| `loading` | Initial or refresh request in progress |
| `loadError` | Safe user-facing read failure; replaces stale action controls with Retry |
| `pending` | Checkout or portal request in progress; disables mutation controls |
| `canManage` | App authorization display hint, false by default; never replaces server authorization |
| `canReadHistory` | Separate billing-history read permission hint, false by default |
| `history` | One authorized `{collection, items, nextCursor}` provider page, or null |
| `historyLoading` | History request pending; displays skeletons and disables page/collection requests |
| `historyError` | Safe history read failure; hides stale rows and offers Retry |
| `locale` | Optional locale for integer credit and UTC date formatting |

Subscription records contain `id`, `planId`, `status`, and `periodEnd` in UTC
milliseconds. `payments-core`'s authorized `checkout.account({actor, subjectId})`
returns the account projection. The app derives actor and subject from its own
authenticated identity and membership. Its `authorize` callback receives action
`account`; allow read-only members independently of `checkout` and `portal` if
that is the application's policy.

Build display plans on the server from validated configuration and the selected
merchant/environment's published catalogue. `available` is true only for a
published price the current runtime adapter can sell. Format `priceLabel` using
the currency's supported provider minor-unit rules and the user's locale; do not
assume every currency has two decimal places. Include billing interval and any
applicable tax clarification. Never serialize the entire integration config or
Env into these props. Display price and availability are not checkout authority:
the server chooses the published provider price from the submitted logical ID.

The component emits:

- `checkout(planId)`: request checkout for a selected logical plan.
- `portal()`: request a short-lived customer portal session.
- `refresh()`: reload current server state, including after returning from checkout.
- `history({collection, after})`: load the selected provider history page.
- `retry-history()`: retry the app's last failed history query.

An open subscription, including overdue, paused or incomplete, disables another
checkout and directs the customer to billing management. Cancellation or an
expired incomplete subscription permits a new checkout. The provider portal's
plan-change/cancellation options must be configured by the merchant. A disabled
button is a UI guard only. The server service also rejects a new checkout when
its reconciled account contains an open subscription, while allowing recovery of
an already completed request ID. Before webhook reconciliation, separate checkout
sessions can still be open at the provider; retain one request ID for an ongoing
purchase intent. Application authorization remains mandatory on every request.

## Application composition

Keep the page small. Use the application's existing `useView()` for the account
read and `useCommand()` for checkout and portal, from `@jskit-ai/http-web`.
These supply scoped paths, credentials/CSRF, query state and shared mutation
feedback. Bind their states and actions to the component:

```vue
<PaymentAccount
  :account="billing.record?.account ?? null"
  :plans="billing.record?.plans ?? []"
  :can-manage="billing.record?.canManage === true"
  :loading="billing.isLoading || billing.isFetching"
  :load-error="billing.loadError"
  :pending="checkout.isRunning || portal.isRunning"
  @refresh="billing.refresh()"
  @checkout="startCheckout"
  @portal="portal.run()"
/>
```

Here `billing`, `checkout` and `portal` are the app's normal configured hooks,
not exports of this package. Mount the routes with the framework already used by
the app. Connect them to the explicitly composed server services:

| App route purpose | Server call |
|---|---|
| Read billing account | `checkoutService.account({actor, subjectId})`, plus safe display plans and the app's management permission |
| Begin checkout | `checkoutService.checkout({actor, subjectId, email, planId, requestId})` |
| Open billing portal | `checkoutService.portal({actor, subjectId})` |
| Provider webhook | `checkoutService.webhook({rawBody, signature})` |
| Read provider billing history | `checkoutService.history({actor, subjectId, collection, after})` |

History uses the app's existing `useList()` or `useEndpointResource()` read hook,
with query identity including billable subject, collection and cursor. Bind its
loading/error states and clear the prior subject's page when identity changes.
On `history`, select that query; on `retry-history`, refetch the failed query.
Replace the page instead of automatically walking every provider page. A new
collection selection starts at `after: null`; the Next control uses `nextCursor`.
Reject stale results after subject changes, and disable reads when the app's
history policy denies access. No request orchestration is duplicated here.

History item fields come from the core contract: `id`, `kind`, `status`,
`createdAt`, and financial records' `currency`, `totalMinor`, `paidMinor`. The app
adds `totalLabel` and, when the paid amount is known, `paidLabel`, using its money
formatter and currency-specific minor units. Keep large integer strings exact.
Null amounts stay unknown. Stripe rows are invoices; Paddle rows are transactions.
Neither a row nor its total proves settlement, and this view does not grant access
or credits. This is customer-scoped history, not merchant-wide reporting or
refund/cancellation administration.

The app's `startCheckout(planId)` creates and retains a request ID for that user
intent, including retry after a lost HTTP response; it calls the checkout command
with that ID and plan ID. The backend gets email from authenticated billing
contact data, not arbitrary browser identity claims. Serialize concurrent billing
mutations for the same account through the existing service. An uncertain
provider outcome requires the documented server reconciliation operation, not
an automatic retry loop.

On successful checkout/portal command, navigate to the URL returned by the
app's server. Do not accept an arbitrary return/provider URL from query parameters
or browser inputs. Configure the provider and destination in server composition.
Mutation errors use `useCommand()`'s normal feedback path. The component does not
insert a second error banner or duplicate that request state. Re-read on the
return route; a success query parameter must never grant paid access.

Laravel owns its native server and UI implementation. An Inertia/Vue application
can choose this presentational component, but no JSKIT runtime is required for
Laravel to implement the documented JSON account/plan display shape and actions.

## Evidence

The focused package test compiles and mounts the Vue component with lightweight
host controls and checks loaded, pending, overdue, unauthorized, error/retry and
loading behavior. A separate browser fixture uses real Vuetify and controlled
component inputs, without a generated application or provider connection:

```sh
JSKIT_PAYMENTS_WEB_BROWSER_INTEGRATION=1 node --test --test-concurrency=1 packages/payments-web/test/paymentAccount.browser.test.js
```

Run that command from the JSKIT repository root with its prepared browser tools.
It checks 390, 768, 1024 and 1440 pixel widths plus a short desktop viewport,
unclipped invoice references, 48-pixel controls, keyboard checkout/portal events,
history pagination/retry, denied and pending actions, overdue subscriptions,
account retry and initial loading. This verifies the component's presentation
and emitted events; the consuming app still owns authorized routes, provider
requests and payment completion. It is not live-provider acceptance.
