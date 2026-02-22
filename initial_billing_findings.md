# Initial Billing Findings (`/admin/w/:workspaceSlug/billing`)

1. High: extras “catalog” is built from core plan prices, not an extras catalog.
   - `src/views/workspace-billing/useWorkspaceBillingView.js:142`
   - `src/views/workspace-billing/useWorkspaceBillingView.js:167`
   - The one-off catalog is derived from `plan.corePrice`, which conflicts with the simplified model (core subscription checkout vs separate extras flow).

2. High: one-off UI nudges users toward the same wrong coupling.
   - `src/views/workspace-billing/WorkspaceBillingView.vue:63`
   - `src/views/workspace-billing/WorkspaceBillingView.vue:104`
   - The “Catalog item” UX effectively points to plan prices, so users can confuse core plans with extras.

3. Medium: missing empty-state/disabled-state for subscription checkout.
   - `src/views/workspace-billing/WorkspaceBillingView.vue:35`
   - `src/views/workspace-billing/WorkspaceBillingView.vue:55`
   - If there are no active plans, CTA remains visible/clickable and fails later with generic validation.

4. Medium: shared error state leaks across tabs.
   - `src/views/workspace-billing/useWorkspaceBillingView.js:216`
   - `src/views/workspace-billing/useWorkspaceBillingView.js:218`
   - `src/views/workspace-billing/WorkspaceBillingView.vue:24`
   - `src/views/workspace-billing/WorkspaceBillingView.vue:150`
   - A single computed error is shown in both purchase and timeline tabs, causing cross-tab UX noise.

5. Low: dead ternary in catalog payment-link success message.
   - `src/views/workspace-billing/useWorkspaceBillingView.js:338`
   - Both branches return `"Payment link created."`.

6. Medium: no focused client tests for workspace billing view/composable.
   - No dedicated tests for `WorkspaceBillingView` or `useWorkspaceBillingView`.
   - This makes regressions in checkout/payment-link UX easier to ship unnoticed.
