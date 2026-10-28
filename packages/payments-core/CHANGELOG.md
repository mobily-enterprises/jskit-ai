# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- `PaymentError` takes `{ messageCode, messageParams }` as its fourth argument; existing `payment_*` codes keep their values.

### New message keys (53)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.errors.payment_plan_unknown`
- `jskit.errors.payment_readiness_invalid`
- `jskit.errors.payment_forbidden`
- `jskit.errors.payment_operation_conflict`
- `jskit.errors.payment_request_invalid`
- `jskit.errors.payment_subscription_exists`
- `jskit.errors.payment_history_unavailable`
- `jskit.errors.payment_customer_missing`
- `jskit.errors.payment_reconciliation_required`
- `jskit.errors.payment_customer_conflict`
- `jskit.errors.payment_catalogue_pending`
- `jskit.errors.payment_catalogue_uncertain`
- `jskit.errors.payment_balance_limit`
- `jskit.errors.payment_feature_required`
- `jskit.errors.payment_insufficient_credits`
- `jskit.errors.payment_debit_missing`
- `jskit.errors.payment_customer_unbound`
- `jskit.payments.scope.readinessMismatch`
- `jskit.payments.scope.catalogueMismatch`
- `jskit.payments.scope.merchantMismatch`
- `jskit.payments.operation.unfinished`
- `jskit.payments.operation.mayHaveSucceeded`
- `jskit.payments.input.billingEmail`
- `jskit.payments.input.historyPage`
- `jskit.payments.input.historyCollection`
- `jskit.payments.input.recoveryObjectId`
- `jskit.payments.input.reference`
- `jskit.payments.input.creditQuantity`
- `jskit.payments.input.timestamp`
- `jskit.payments.reference.otherPlan`
- `jskit.payments.reference.differentInputs`
- `jskit.payments.provider.checkAccount`
- `jskit.payments.provider.unsupportedEvent`
- `jskit.payments.provider.objectIdMissing`
- `jskit.payments.provider.subscriptionBinding`
- `jskit.payments.provider.renewalBinding`
- `jskit.payments.webhook.rawBodyRequired`
- `jskit.payments.webhook.verificationFailed`
- `jskit.payments.configuration.invalid`
- `jskit.payments.configuration.taxCategoryUnpublishable`
- `jskit.payments.configuration.sharedConnectionRequired`
- `jskit.payments.configuration.paddleEnvironment`
- `jskit.payments.configuration.paddleTaxCategory`
- `jskit.payments.configuration.paddleClientToken`
- `jskit.payments.catalogue.reviewFirst`
- `jskit.payments.catalogue.publicationChanged`
- `jskit.payments.catalogue.planChanged`
- `jskit.payments.catalogue.productChanged`
- `jskit.payments.catalogue.priceChanged`
- `jskit.payments.catalogue.pendingCatalogueRequestChanged`
- `jskit.payments.catalogue.recoveryReviewChanged`
- `jskit.payments.catalogue.pendingRequestChanged`
- `jskit.payments.catalogue.objectMismatch`

</details>

### Codes (53)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `payment_plan_unknown` | Select a published payment plan. |
| `payment_readiness_invalid` | App readiness checks must return bounded status and safe explanatory text. |
| `payment_forbidden` | You cannot manage this billable account. |
| `payment_operation_conflict` | The pending payment operation changed. |
| `payment_request_invalid` | Supply a stable checkout request identifier. |
| `payment_subscription_exists` | Manage the existing subscription through billing instead of starting another checkout. |
| `payment_history_unavailable` | Billing history could not be loaded. Check provider access and retry. |
| `payment_customer_missing` | Create a billing account first. |
| `payment_reconciliation_required` | Provider inspection did not resolve this request. |
| `payment_customer_conflict` | This provider customer is already bound to a different billable subject. |
| `payment_catalogue_pending` | Another catalogue request needs resolution. |
| `payment_catalogue_uncertain` | Catalogue publication stopped. Inspect the pending provider request before retrying; completed items are preserved. |
| `payment_balance_limit` | Credit balance exceeds the supported integer range. |
| `payment_feature_required` | Your subscription does not include this feature. |
| `payment_insufficient_credits` | Not enough credits for this action. |
| `payment_debit_missing` | No debit exists for this reference. |
| `payment_customer_unbound` | Bind this provider customer before processing its events. |
| `payments.scope.readinessMismatch` | Readiness returned a different payment account or environment. |
| `payments.scope.catalogueMismatch` | Catalogue scope does not match its configured environment. |
| `payments.scope.merchantMismatch` | The payment scope does not match this environment's merchant configuration. |
| `payments.operation.unfinished` | Inspect the unfinished provider request before retrying. |
| `payments.operation.mayHaveSucceeded` | Inspect this account's provider activity before retrying; the request may have succeeded. |
| `payments.input.billingEmail` | Supply the authenticated billing contact's email. |
| `payments.input.historyPage` | Select billing subscriptions or transactions and a valid page cursor. |
| `payments.input.historyCollection` | Select a billing history collection. |
| `payments.input.recoveryObjectId` | Supply the exact provider object ID to recover. |
| `payments.input.reference` | Use a nonempty business reference of at most 150 characters. |
| `payments.input.creditQuantity` | Use a positive integer credit quantity, at most one billion. |
| `payments.input.timestamp` | Use an integer UTC timestamp in milliseconds. |
| `payments.reference.otherPlan` | The checkout request already selected another plan. |
| `payments.reference.differentInputs` | This business reference was already used with different inputs. |
| `payments.provider.checkAccount` | Check the {provider} account, price mapping and subscription shape. |
| `payments.provider.unsupportedEvent` | The event is not a supported subscription payment for this customer. |
| `payments.provider.objectIdMissing` | The provider did not return an object ID. |
| `payments.provider.subscriptionBinding` | Check the provider subscription and logical price binding. |
| `payments.provider.renewalBinding` | Check the renewal's logical price binding. |
| `payments.webhook.rawBodyRequired` | Supply the unmodified webhook request bytes. |
| `payments.webhook.verificationFailed` | {provider} webhook verification failed. |
| `payments.configuration.invalid` | Check the application's payment configuration. |
| `payments.configuration.taxCategoryUnpublishable` | Set the application's Paddle product tax category before publishing. |
| `payments.configuration.sharedConnectionRequired` | Select a shared Stripe or Paddle connection with a backend API-key Env reference for {environment}. |
| `payments.configuration.paddleEnvironment` | Select a Paddle connection configured for {environment}. |
| `payments.configuration.paddleTaxCategory` | Choose the Paddle tax category for the products this app sells. |
| `payments.configuration.paddleClientToken` | Set the Env reference for this environment's Paddle public client token. |
| `payments.catalogue.reviewFirst` | Review the current catalogue and resolve provider drift or unfinished requests first. |
| `payments.catalogue.publicationChanged` | Another publication changed the catalogue; review again. |
| `payments.catalogue.planChanged` | This plan changed; review again. |
| `payments.catalogue.productChanged` | This product changed; review again. |
| `payments.catalogue.priceChanged` | This price changed; review again. |
| `payments.catalogue.pendingCatalogueRequestChanged` | The pending catalogue request changed. |
| `payments.catalogue.recoveryReviewChanged` | The recovery review changed. Inspect the current pending operation first. |
| `payments.catalogue.pendingRequestChanged` | The pending request changed. |
| `payments.catalogue.objectMismatch` | The provider object does not match the pending operation. |
