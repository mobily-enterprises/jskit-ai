# `@jskit-ai/billing-plan-client-element`

Shared client element that owns the reusable billing-plan UI shell.

## What This Package Owns

1. Workspace billing heading and description.
2. Billing action alert area.
3. Current plan section.
4. Scheduled change section.
5. Change core plan section.

## What Stays App-Local

1. Billing runtime/composable wiring and API calls.
2. Workspace policy/auth decisions.
3. Usage limits card.
4. One-off purchases and purchase history sections.

## Required Props

1. `meta` with formatters/helpers (for example `formatDateOnly`, `formatMoneyMinor`).
2. `state` with display-ready billing state.
3. `actions` with callbacks (`submitPlanChange`, `cancelCurrentPlan`, `cancelPendingPlanChange`).

## Optional Props

1. `copy` text override map.
2. `variant` with `layout`, `surface`, `density`, `emphasis`.
3. `features` section/visibility toggles.
4. `ui` class and test-id hook map.

## Events

1. `action:started`
2. `action:succeeded`
3. `action:failed`
4. `interaction`
5. `plan-change:submit`
6. `plan-change:cancel-current`
7. `plan-change:cancel-scheduled`
8. `checkout:open`

## Slots

1. `header-extra`
2. `current-plan-extra`
3. `scheduled-change-extra`
4. `change-core-plan-extra`
5. `footer-extra`

## Variants

1. `layout`: `compact | comfortable`
2. `surface`: `plain | carded`
3. `density`: `compact | comfortable`
4. `emphasis`: `default | quiet`

## Customization

Use `copy`, `variant`, `features`, and `ui` together:

1. Override labels/headings/helpers with `copy`.
2. Adjust spacing/surface density with `variant`.
3. Hide optional sections/actions with `features`.
4. Apply host classes/test hooks with `ui.classes` and `ui.testIds`.

## Eject

Raw source export is available:

- `@jskit-ai/billing-plan-client-element/source/BillingPlanClientElement.vue`

Example copy command:

```bash
cp node_modules/@jskit-ai/billing-plan-client-element/src/BillingPlanClientElement.vue apps/jskit-value-app/src/components/BillingPlanClientElement.ejected.vue
```

## Support policy

Maintained by Shared UI Guild as a shared contract package. Any breaking prop/event/slot changes require migration notes and coordinated app updates.

## Versioning policy

1. Contract-safe additions ship as minor/patch updates.
2. Breaking prop/event/slot changes require explicit migration notes.

## Migration notes

Initial extraction target: `apps/jskit-value-app/src/views/workspace-billing/WorkspaceBillingView.vue`.
