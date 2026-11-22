# Changelog

## Unreleased

- `PaymentTopUp` (`./client/components/PaymentTopUp`): choose a top-up amount within the offer's limits (emitted in the currency's smallest unit), then each state of the top-up: waiting for the payment tab on a framed page (checking again when the page regains focus), a blocked tab, an unfinished payment on the return page, processing, paid, failed and expired. New messages `jskit.payments.topUp.*` (22).
- `openPaymentPage(url, page?)` (`./client/openPaymentPage`): goes to a Checkout URL in this tab, or, on a framed page (a Preview pane), opens it with `window.open(url, "_blank")` and cuts the new tab's opener itself, answering `"redirected"`, `"opened"` or `"blocked"`.

- Plans show as filled Material 3 cards (`surface-container-highest`) instead of bordered boxes.

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (43)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.payments.account.region`
- `jskit.payments.account.retryDetails`
- `jskit.payments.account.availableCredits`
- `jskit.payments.account.includedFeatures`
- `jskit.payments.account.noPaidFeatures`
- `jskit.payments.account.subscriptions`
- `jskit.payments.account.periodEnd`
- `jskit.payments.account.noSubscription`
- `jskit.payments.account.manageBilling`
- `jskit.payments.account.refreshDetails`
- `jskit.payments.account.adminManages`
- `jskit.payments.account.useManageBilling`
- `jskit.payments.account.confirmationNote`
- `jskit.payments.account.availablePlans`
- `jskit.payments.account.renewalCredits`
- `jskit.payments.account.choosePlan`
- `jskit.payments.account.choosePlanNamed`
- `jskit.payments.account.notAvailableForCheckout`
- `jskit.payments.account.noPlans`
- `jskit.payments.account.unavailable`
- `jskit.payments.account.status.active`
- `jskit.payments.account.status.trialing`
- `jskit.payments.account.status.pastDue`
- `jskit.payments.account.status.paused`
- `jskit.payments.account.status.canceled`
- `jskit.payments.account.status.unpaid`
- `jskit.payments.account.status.incomplete`
- `jskit.payments.account.status.incompleteExpired`
- `jskit.payments.account.history.region`
- `jskit.payments.account.history.viewTransactions`
- `jskit.payments.account.history.viewSubscriptions`
- `jskit.payments.account.history.retry`
- `jskit.payments.account.history.unpaidNote`
- `jskit.payments.account.history.records`
- `jskit.payments.account.history.invoice`
- `jskit.payments.account.history.transaction`
- `jskit.payments.account.history.subscription`
- `jskit.payments.account.history.statusAndDate`
- `jskit.payments.account.history.total`
- `jskit.payments.account.history.totalPending`
- `jskit.payments.account.history.totalAndPaid`
- `jskit.payments.account.history.empty`
- `jskit.payments.account.history.nextPage`

</details>
