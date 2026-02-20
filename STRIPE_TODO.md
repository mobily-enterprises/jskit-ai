# Stripe and Billing TODO

## Super-Detailed Plan: Surface-Agnostic Billing + JSON Constraints

### A) Core Concepts (Vocabulary)

- **Billable Entity**: The thing that pays. Examples: `user`, `workspace`, `org`, `team`, `project`.
- **Surface**: Where features are accessed (app UI, workspace admin, console, etc).
  Surfaces do not own billing; they only resolve which billable entity applies.
- **Plan**: Pricing + provider mapping + entitlements (constraints).
- **Subscription**: Provider-owned state tied to a Billable Entity.
- **Entitlement**: JSON constraint rules granted by a plan.
- **Policy (config)**: Surface to billable entity resolution + required entitlements.

### B) Data Model (Schema Design)

1. **`billable_entities`**
   - `id` (PK)
   - `entity_type` (string; extensible)
   - `entity_id` (int/uuid)
   - `owner_user_id` (primary payer/admin)
   - `status` (`active`, `inactive`)
   - timestamps
   - **Unique**: `(entity_type, entity_id)`
   - **Indexes**: `(entity_type, entity_id)`, `owner_user_id`

2. **`billing_plans`**
   - `id`, `code`, `name`, `description`
   - `applies_to_entity_type` (e.g. `user`, `workspace`)
   - `pricing_model`: `flat`, `per_seat`, `usage`, `hybrid`
   - `currency`, `amount`, `interval`, `interval_count`
   - `is_active`
   - Provider mapping: `provider`, `provider_product_id`, `provider_price_id`
   - `metadata_json` (plan-specific config)
   - timestamps
   - **Index**: `(applies_to_entity_type, is_active)`

3. **`billing_entitlements`** (JSON constraints)
   - `id`, `plan_id`, `code`
   - `value_json` (constraint object, see Section E)
   - **Unique**: `(plan_id, code)`

4. **`billing_subscriptions`**
   - `id`, `billable_entity_id`, `plan_id`
   - `provider`, `provider_subscription_id`, `provider_customer_id`
   - `status` (`trialing`, `active`, `past_due`, `paused`, `canceled`, etc.)
   - `current_period_end`, `trial_end`, `canceled_at`, `cancel_at_period_end`
   - `metadata_json`
   - timestamps
   - **Index**: `billable_entity_id`, `plan_id`
   - **Unique**: `(provider, provider_subscription_id)`

5. **`billing_payment_methods`**
   - `id`, `billable_entity_id`
   - provider references only (no raw card data)
   - `type`, `brand`, `last4`, `exp_month`, `exp_year`
   - `is_default`
   - timestamps

6. **`billing_invoices`**
   - `id`, `subscription_id`
   - `provider_invoice_id`, `status`, `amount_due`, `amount_paid`, `amount_remaining`
   - `currency`, `issued_at`, `due_at`, `paid_at`
   - timestamps

7. **`billing_payments`**
   - `id`, `invoice_id`, `subscription_id`, `billable_entity_id`
   - `provider_payment_id`, `type`, `status`, `amount`, `currency`
   - timestamps

### C) Surface Billing Policy (Config-Only)

Static registry in code:

- `SurfaceBillingPolicies`:
  - `surfaceId`:
    - `resolveBillableEntity(context)` -> `{ entityType, entityId, ownerUserId }`
    - `requiredEntitlements` (list of entitlement codes)
    - optional `billingMode` (`required`, `optional`, `trial-ok`)

Examples:

- **App surface**:
  - `resolveBillableEntity`: user self
  - `requiredEntitlements`: `["feature.app.enabled"]`

- **Workspace admin surface**:
  - `resolveBillableEntity`: workspace
  - `requiredEntitlements`: `["feature.workspace.enabled"]`

Surfaces are never stored in DB.

### D) Services (Contracts & Flow)

1. **BillingService**
   - `ensureBillableEntity({ entityType, entityId, ownerUserId })`
   - `listPlans({ entityType })`
   - `getSnapshot({ entityType, entityId })`
     - returns: billableEntity, subscription, plan, entitlements, paymentMethods
   - `createCheckoutSession({ entityType, entityId, planId | planCode, quantity, successPath, cancelPath })`
   - `createPortalSession({ entityType, entityId, returnPath })`

2. **BillingPolicyService**
   - `resolveBillableEntityForSurface(surfaceId, context)`
   - `requireEntitlements(surfaceId, entitlements)`

3. **EntitlementsService**
   - `computeEntitlements(planId)` -> map of entitlement codes to JSON

### E) JSON Constraints (Entitlements Format)

Entitlements are JSON objects stored in `billing_entitlements.value_json`.

Feature flag:
```json
{
  "type": "feature",
  "enabled": true
}
```

Hard limit:
```json
{
  "type": "limit",
  "metric": "users.count",
  "limit": 10
}
```

Windowed limit:
```json
{
  "type": "limit",
  "metric": "chat.messages.count",
  "limit": 200,
  "window": "month"
}
```

Unit-based limit:
```json
{
  "type": "limit",
  "metric": "storage.gb.used",
  "limit": 50,
  "unit": "gb"
}
```

Entitlement code naming:
- `feature.chat.enabled`
- `users.max`
- `chat.messages.max`
- `storage.gb.max`
- `api.requests.max`

### F) Constraint Enforcement (Where + How)

Enforced in service layer, never in repositories.

Constraint helper API:
- `isFeatureEnabled(entitlements, "feature.chat.enabled")`
- `getLimit(entitlements, "users.max") -> { limit, window? }`
- `assertWithinLimit(entitlements, "users.max", currentCount)`
- `assertWindowLimit(entitlements, "chat.messages.max", usageInWindow)`

Usage counters (for windowed limits):
- `usage_counters` table (later phase):
  - `billable_entity_id`, `metric`, `window_start`, `value`

### G) Provider Adapter (Pluggable)

`BillingProvider` interface:

- `createCheckoutSession({ customerId?, priceId, quantity, successUrl, cancelUrl, metadata })`
- `createPortalSession({ customerId, returnUrl })`
- `verifyWebhookSignature(payload, signature)`

Stripe is the default provider but isolated to the adapter only.

### H) API Contracts (Surface-Neutral)

1. **List plans**
   - `GET /api/billing/plans?entityType=workspace`
2. **Current subscription**
   - `GET /api/billing/subscription?entityType=workspace&entityId=123`
3. **Checkout**
   - `POST /api/billing/checkout`
     - `{ entityType, entityId, planId | planCode, quantity, successPath, cancelPath }`
4. **Portal**
   - `POST /api/billing/portal`
     - `{ entityType, entityId, returnPath }`

Controller validates that caller is authorized to bill that entity.

### I) "Pick Your Plan" Flow (Surface-Agnostic)

1. Surface resolves billable entity via policy.
2. Fetch plans for `entityType`.
3. Show plans + current subscription.
4. On plan selection:
   - `POST /api/billing/checkout`
5. Redirect to provider session.
6. Webhook updates subscription state.

### J) Webhooks (Later Phase)

Handle:
- `subscription.created/updated/canceled`
- `invoice.paid/failed`
- `payment_method.attached/detached`

Updates:
- `billing_subscriptions`
- `billing_invoices`
- `billing_payments`
- `billing_payment_methods`

### K) Ownership & Security

- `entityType=user`: only that user can bill
- `entityType=workspace`: only owner/admin can bill
- Enforced via surface policy + ownership checks in service layer

### L) Seeding Strategy

Seed minimum plans:
- `workspace-starter`, `workspace-pro`
- `app-basic`, `app-premium`

Each plan has entitlements JSON.

### M) Tests (Minimal Suite)

- Repository mapping & metadata JSON handling
- Service: wrong entity type, wrong plan, missing provider price
- Route schema: payload validation
