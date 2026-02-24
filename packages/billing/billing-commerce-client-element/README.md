# `@jskit-ai/billing-commerce-client-element`

Shared client element that owns reusable billing commerce and usage-limits UI while policy/runtime remains app-local.

## What This Package Owns

1. One-off purchases grid.
2. Purchase history list.
3. Usage limits cards and status rendering.

## What Stays App-Local

1. Runtime wiring via `useWorkspaceBillingView()`.
2. Auth/workspace policy and permission checks.
3. Billing API calls and mutation semantics.

## Required Props

1. `meta`
2. `state`
3. `actions`

## Optional Props

1. `copy`
2. `variant` (`layout`, `surface`, `density`, `tone`)
3. `features`
4. `ui`

## Events

1. `action:started`
2. `action:succeeded`
3. `action:failed`
4. `interaction`
5. `checkout:open`

## Slots

1. `one-off-extra`
2. `purchase-history-extra`
3. `usage-limits-extra`
4. `footer-extra`

## Variants

1. `layout`: `compact | comfortable`
2. `surface`: `plain | carded`
3. `density`: `compact | comfortable`
4. `tone`: `neutral | emphasized`

## Customization

1. Use `copy` to override titles, labels, and empty/loading text.
2. Use `features` to toggle sections (`oneOffPurchases`, `purchaseHistory`, `usageLimits`, `paymentLink`).
3. Use `ui.classes` and `ui.testIds` for host styling/testing hooks.
4. Use slots to insert extra content per major section.

## Eject

Raw source export:

- `@jskit-ai/billing-commerce-client-element/source/BillingCommerceClientElement.vue`

Example:

```bash
cp node_modules/@jskit-ai/billing-commerce-client-element/src/BillingCommerceClientElement.vue apps/jskit-value-app/src/components/BillingCommerceClientElement.ejected.vue
```

## Support policy

Maintained by Shared UI Guild. Breaking prop/event/slot contract changes require migration notes and coordinated consumer updates.

## Versioning policy

1. Contract-safe additions are minor/patch updates.
2. Breaking interface changes require migration guidance.

## Migration notes

Initial app migration target: `apps/jskit-value-app/src/views/workspace-billing/WorkspaceBillingView.vue`.
