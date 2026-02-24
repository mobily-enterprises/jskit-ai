# `@jskit-ai/billing-console-admin-client-element`

Shared client elements for console billing plans and products administration surfaces.

## What This Package Owns

1. Billing plans admin table and create/view/edit dialogs.
2. Billing products admin table and create/view/edit dialogs.

## What Stays App-Local

1. Query/mutation orchestration and permissions.
2. Provider integration semantics and policy logic.
3. Console route wiring.

## Exports

1. `ConsoleBillingPlansClientElement`
2. `ConsoleBillingProductsClientElement`

## Required Props

1. `meta`
2. `state`
3. `actions`

## Customization

1. Host apps can wrap these elements and pass adapted state/actions.
2. Text and behavior are primarily shaped by the supplied `state/meta/actions` data.

## Eject

Raw source exports:

1. `@jskit-ai/billing-console-admin-client-element/source/ConsoleBillingPlansClientElement.vue`
2. `@jskit-ai/billing-console-admin-client-element/source/ConsoleBillingProductsClientElement.vue`

Example:

```bash
cp node_modules/@jskit-ai/billing-console-admin-client-element/src/ConsoleBillingPlansClientElement.vue apps/jskit-value-app/src/components/ConsoleBillingPlansClientElement.ejected.vue
```

## Support policy

Maintained by Shared UI Guild. Contract-breaking changes require migration notes and coordinated updates.
