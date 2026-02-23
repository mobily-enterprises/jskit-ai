# Permissions And Entitlements Reference (LLM Bootstrap)

Status: authoritative machine-oriented knowledge pack for this repo state
Scope date: 2026-02-22 codebase snapshot
Audience: LLM/agent prompts (not human-first prose)

If this document conflicts with code, code wins.
Primary runtime sources: `server/`, `shared/`, `src/`, `migrations/`.

## 0. Core Separation (Do Not Confuse These)

1. Permissions (RBAC) answer: "Can this actor access/perform this action?"
2. Entitlements answer: "How much capacity/quota/credit does this subject have left?"
3. They are intentionally separate systems.
4. RBAC is role/membership based.
5. Entitlements are billing/grant/consumption/expiry based.

Non-negotiable mental model:

- A user can have permission to perform an action in principle (`projects.write`) and still be blocked by entitlements (`projects.max` over cap).
- A user can lack permission (`workspace.billing.manage`) and never reach entitlement-mutating paths.

## 1. High-Level Architecture Map

### 1.1 Permissions Stack (Workspace/App/Admin)

1. Route config (auth/workspace/permission metadata) is attached in `server/fastify/registerApiRoutes.js`.
2. `server/fastify/auth.plugin.js` authenticates + resolves workspace context + enforces route `permission`.
3. Workspace permission set is derived from singular membership `roleId` + RBAC manifest (`shared/auth/rbac.manifest.json`).
4. Surface policies (`server/surfaces/*.js`) can further deny access (notably app-surface deny lists).
5. Realtime subscriptions re-check workspace access + topic permissions (`server/realtime/registerSocketIoRealtime.js` + `shared/realtime/topicRegistry.js`).

### 1.2 Permissions Stack (Console)

1. Console routes are mostly `auth: required` only (`server/modules/console/routes.js`).
2. Console permission enforcement happens in console services (`server/domain/console/services/*.js`) via `requirePermission(...)`.
3. Console roles/permissions are separate from workspace RBAC (`server/domain/console/policies/roles.js`).

### 1.3 Entitlements Stack

1. Canonical meanings: `billing_entitlement_definitions`
2. Plan/product grant templates: `billing_plan_entitlement_templates`, `billing_product_entitlement_templates`
3. Append-only value events:
   - grants: `billing_entitlement_grants`
   - consumptions: `billing_entitlement_consumptions`
4. Runtime projection/cache: `billing_entitlement_balances`
5. Optional helper: `billing_resource_snapshots` (created, but core scaffold currently uses direct counts for `projects.max`)
6. Orchestration:
   - repository: `server/modules/billing/repository.js`
   - service: `server/modules/billing/service.js`
   - webhook projections: `server/modules/billing/webhookSubscriptionProjection.service.js`
   - worker boundary tick: `server/modules/billing/workerRuntime.service.js`
   - realtime publish: `server/modules/billing/realtimePublish.service.js`

## 2. Table-First Inventory (Permissions + Entitlements)

This section is the "what tables exist and what they mean" map.

### 2.1 Permission-Related Tables (Workspace / Console)

#### `workspaces`

Purpose: workspace entity/root context for workspace memberships and workspace-scoped permissions.

Defined in `migrations/20260217120000_create_workspaces.cjs`.

Important columns:

- `id`
- `slug` (unique)
- `name`
- `owner_user_id` (FK `user_profiles.id`)
- `is_personal`
- `created_at`, `updated_at`

Permission relevance:

- Owner identity used by workspace admin service and billing billable-entity resolution.

#### `workspace_memberships`

Purpose: canonical workspace membership + role assignment (single role per user per workspace).

Defined in `migrations/20260217120100_create_workspace_memberships.cjs`.

Important columns:

- `workspace_id`
- `user_id`
- `role_id` (singular)
- `status` enum: `active | invited | suspended`
- timestamps

Constraints/invariants:

- Unique (`workspace_id`, `user_id`)
- There is exactly one `role_id` per membership row.
- This schema does not support multi-role membership.

#### `workspace_settings`

Purpose: workspace-level feature/policy config; includes app-surface deny-list policy in `features_json`.

Defined in `migrations/20260217120200_create_workspace_settings.cjs`.

Important columns:

- `workspace_id` (PK + FK)
- `invites_enabled`
- `features_json`
- `policy_json`
- timestamps

Permission relevance:

- App-surface deny lists are stored under `features.surfaceAccess.app.denyUserIds` / `denyEmails` (created on demand by settings patch flow).

#### `workspace_invites`

Purpose: invitation workflow with invited role assignment target.

Defined in `migrations/20260217120300_create_workspace_invites.cjs`.

Important columns:

- `workspace_id`
- `email`
- `role_id`
- `token_hash`
- `invited_by_user_id`
- `expires_at`
- `status` enum: `pending | accepted | revoked | expired`

Permission relevance:

- `role_id` is the future workspace role to assign on invite accept.

#### `console_memberships`

Purpose: console-surface membership + role assignment (separate from workspace memberships).

Defined in `migrations/20260220090000_create_console_memberships.cjs`.

Important columns:

- `user_id` (unique)
- `role_id` (singular console role)
- `status` enum: `active | suspended`
- timestamps

Special invariant:

- Generated column `active_console_singleton` + unique index enforces at most one active membership with `role_id='console'`.

#### `console_invites`

Purpose: console invitation workflow (separate from workspace invites).

Defined in `migrations/20260220090100_create_console_invites.cjs`.

Important columns:

- `email`
- `role_id`
- `token_hash`
- `invited_by_user_id`
- `expires_at`
- `status` enum: `pending | accepted | revoked | expired`

Special invariant:

- Generated column `pending_email` + unique index enforces one pending invite per email.

#### `console_root_identity`

Purpose: records console "root" user identity for special mutation protections.

Defined in `migrations/20260220090200_create_console_root_identity.cjs`.

Important columns:

- `id` (singleton row id pattern)
- `user_id` (unique nullable)

Permission relevance:

- Only root can modify root user membership/role.

#### `console_settings`

Purpose: console-level settings (including assistant settings; billing behavior settings may also be stored via settings services).

Defined in `migrations/20260220140000_create_console_settings.cjs`.

Important columns:

- `id`
- `features_json`
- timestamps

### 2.2 Entitlement Engine Tables (Billing)

Defined in `migrations/20260222230000_create_billing_entitlements_engine_tables.cjs`.

#### `billing_entitlement_definitions`

Purpose: canonical dictionary of entitlement codes and accounting semantics.

This is the answer to "what does `projects.max` mean?"

Key columns:

- `code` (unique stable key)
- `entitlement_type`: `capacity | metered_quota | balance | state`
- `unit`
- `window_interval`: `day | week | month | year | null`
- `window_anchor`: `calendar_utc | rolling | null`
- `aggregation_mode`: `sum | max | boolean_any_true`
- `enforcement_mode`: `hard_deny | hard_lock_resource | soft_warn`
- `scope_type`: `billable_entity | workspace | user`
- `is_active`
- `metadata_json`

Checks:

- Metered quotas require non-null window interval + anchor.
- Non-metered types require null window interval + anchor.

#### `billing_plan_entitlement_templates`

Purpose: typed plan-based grant templates (runtime source for plan-derived entitlement grants).

Key columns:

- `plan_id`
- `entitlement_definition_id`
- `amount`
- `grant_kind`: `plan_base | plan_bonus`
- `effective_policy`: `on_assignment_current | on_period_paid`
- `duration_policy`: `while_current | period_window | fixed_duration`
- `duration_days` (only for `fixed_duration`)
- `metadata_json`

Constraints:

- Unique (`plan_id`, `entitlement_definition_id`, `grant_kind`)
- `duration_days` check enforces policy compatibility

#### `billing_product_entitlement_templates`

Purpose: typed product-based grant templates (runtime source for product purchase grants).

Key columns:

- `billing_product_id`
- `entitlement_definition_id`
- `amount`
- `grant_kind`: `one_off_topup | timeboxed_addon`
- `duration_days` (required for `timeboxed_addon`, null for `one_off_topup`)
- `metadata_json`

Constraints:

- Unique (`billing_product_id`, `entitlement_definition_id`, `grant_kind`)
- `duration_days` check enforces grant-kind compatibility

#### `billing_entitlement_grants`

Purpose: append-only grant ledger ("rights/credits/capacity added").

Key columns:

- `subject_type` (currently `billable_entity`)
- `subject_id`
- `entitlement_definition_id`
- `amount`
- `kind`: `plan_base | addon_timeboxed | topup | promo | manual_adjustment | correction`
- `effective_at`
- `expires_at` nullable
- `source_type`: `plan_assignment | billing_purchase | billing_event | manual_console | system_worker`
- `source_id`
- `operation_key`
- `provider`
- `provider_event_id`
- `dedupe_key` (unique)
- `metadata_json`
- `created_at`

Checks:

- `expires_at` must be null or strictly after `effective_at`

#### `billing_entitlement_consumptions`

Purpose: append-only consumption ledger ("rights/credits/quota spent").

Key columns:

- `subject_type` (currently `billable_entity`)
- `subject_id`
- `entitlement_definition_id`
- `amount` (positive)
- `occurred_at`
- `reason_code`
- `operation_key`
- `usage_event_key`
- `provider_event_id`
- `request_id`
- `dedupe_key` (unique)
- `metadata_json`
- `created_at`

#### `billing_entitlement_balances`

Purpose: materialized projection/cache used for runtime decisions and UI reads.

Key columns:

- `(subject_type, subject_id, entitlement_definition_id, window_start_at, window_end_at)` unique identity
- `granted_amount`
- `consumed_amount`
- `effective_amount`
- `hard_limit_amount`
- `over_limit`
- `lock_state` enum: `none | projects_locked_over_cap | workspace_expired` (nullable in schema, but runtime usually writes `"none"`)
- `next_change_at`
- `last_recomputed_at`
- `version`
- `metadata_json`

Runtime read path:

- `GET /api/billing/limitations` reads this projection (via billing service/repository) after recompute refresh.

#### `billing_resource_snapshots`

Purpose: optional snapshot table for capacity-like resource counts.

Current scaffold reality:

- Table exists.
- Core `projects.max` capacity recompute currently uses direct `workspace_projects` count (`status != archived`) unless a resolver is injected.

## 3. Source Of Truth Hierarchy (Entitlements)

This is the single most important entitlement rule set.

### 3.1 Canonical Runtime Sources

1. Definition semantics: `billing_entitlement_definitions`
2. Plan grants: `billing_plan_entitlement_templates`
3. Product grants: `billing_product_entitlement_templates`
4. Grant ledger: `billing_entitlement_grants`
5. Consumption ledger: `billing_entitlement_consumptions`
6. Computed state: `billing_entitlement_balances`

### 3.2 Non-Canonical / Edge / Supplemental JSON

There IS JSON in the system, but not as the runtime source of entitlement enforcement/projection.

Allowed JSON roles:

1. API/UI authoring edge payloads (console plan/product `entitlements` arrays) before transformation
2. `metadata_json` columns for audit, provenance, round-trip context, and supplemental details
3. Migration/bootstrap compatibility input (reading existing catalog `metadata_json.entitlements`)

Non-allowed role (runtime):

- Runtime grant projection must NOT derive grants from raw plan/product metadata blobs.

### 3.3 "No legacy here" Clarification

In this repo state:

- The entitlement engine is the runtime implementation.
- The only "historical compatibility" behavior is migration/bootstrap code reading existing catalog metadata to generate typed templates during cutover.
- Runtime grant projection after migration reads typed template tables only.

## 4. Permission System (Workspace RBAC)

## 4.1 RBAC Manifest (`shared/auth/rbac.manifest.json`)

Current workspace roles:

1. `owner` (non-assignable, `["*"]`)
2. `admin`
3. `member`
4. `viewer`

Current notable permissions:

- `workspace.billing.manage` (in `admin`)
- workspace member/invite/settings/roles permissions
- project/history permissions
- transcript permissions

Important nuance:

- There is no inheritance graph engine.
- "Permissions grow upward" is only true because the manifest entries were authored that way.
- The system computes permission sets directly from the role's explicit permission list (plus owner wildcard).

## 4.2 RBAC Manifest Normalization (`server/lib/rbacManifest.js`)

Implemented invariants:

1. `roles.owner` must exist (auto-injected if missing).
2. `roles.owner.assignable` must be `false`.
3. `roles.owner.permissions` must include `"*"`.
4. Role permissions are normalized to unique non-empty strings.
5. `defaultInviteRole` is only retained if it exists and is assignable.
6. `collaborationEnabled` is true only when assignable roles exist AND a valid assignable default invite role exists.

Core helpers:

- `resolveRolePermissions(manifest, roleId)`
- `hasPermission(permissionSet, permission)`
- `listManifestPermissions(...)`

## 4.3 Request Auth + Permission Enforcement Pipeline

Primary files:

- `server/fastify/registerApiRoutes.js`
- `server/fastify/auth.plugin.js`

Route config fields (attached to `fastify.route({ config: ... })`):

- `authPolicy`: `public | required | own`
- `workspacePolicy`: `none | optional | required`
- `workspaceSurface`: explicit surface override (`app`, `admin`, etc.)
- `permission`: permission string enforced by `auth.plugin`
- `csrfProtection`: defaults true (disabled for webhooks)
- `ownerParam` / `ownerResolver` / `userField` for `authPolicy="own"`

`auth.plugin` behavior summary:

1. Runs on `/api/*`.
2. Enforces CSRF on unsafe methods unless disabled.
3. Authenticates request (`authService.authenticateRequest`).
4. Writes/clears auth cookies if requested by auth service.
5. Populates:
   - `request.user`
   - `request.workspace`
   - `request.membership`
   - `request.permissions`
6. If route requests workspace context or route permission, calls `workspaceService.resolveRequestContext(...)`.
7. If route config has `permission`, enforces `hasPermission(request.permissions, permission)` and returns `403` on failure.

## 4.4 Workspace Selection + Context Resolution (`workspace.service`)

Primary file: `server/domain/workspace/services/workspace.service.js`

Input to `resolveRequestContext(...)`:

- `user`
- `request`
- `workspacePolicy` (`none|optional|required`)
- `workspaceSurface` (optional override)

Selector resolution:

- Surface precedence (`server/domain/workspace/lookups/workspaceRequestContext.js`):
  1. explicit `workspaceSurface` route config
  2. header `x-surface-id`
  3. path-derived surface via `shared/routing/surfacePaths.js`

- Workspace slug precedence:
  1. header `x-workspace-slug`
  2. query `workspaceSlug`
  3. params `workspaceSlug`

Selection fallback behavior (simplified actual code flow):

1. Requested slug (if provided)
2. `user_settings.last_active_workspace_id`
3. If exactly one membership, use that

Failure semantics:

- Rejected requested slug (not accessible for surface/user) -> `403`
- `workspacePolicy="required"` and no selected workspace -> `409 "Workspace selection required."`

Output shape includes:

- `workspace` (public workspace summary + public settings)
- `membership` (`{ roleId, status }` or null)
- `permissions` (derived array)
- `workspaces` (visible workspace summaries with `roleId` and `isAccessible`)
- `userSettings`

## 4.5 Workspace Surface Policies (`server/surfaces/*.js`)

### App Surface (`server/surfaces/appSurface.js`)

Requires:

1. authenticated user
2. active membership with singular `roleId`

Additional deny overlays:

- `workspaceSettings.features.surfaceAccess.app.denyUserIds`
- `workspaceSettings.features.surfaceAccess.app.denyEmails`

Denial reasons include:

- `authentication_required`
- `membership_required`
- `user_denied`
- `email_denied`

If allowed:

- permissions = `resolvePermissions(membership.roleId)` via workspace service / RBAC manifest.

### Admin Surface (`server/surfaces/adminSurface.js`)

Requires:

1. active workspace membership

No app-surface deny-list overlay.
Permissions derive from membership role.

## 4.6 Workspace Membership Model = Single Role (Current Design)

Primary evidence:

- `workspace_memberships.role_id` column (singular)
- `normalizeMembershipForAccess(...)` returns one `roleId`
- all workspace permission resolution paths accept one `roleId`
- admin member update endpoint updates exactly one `roleId`

Implications:

1. No multi-role union logic exists.
2. No role precedence/conflict resolution exists.
3. Auditing and UI remain simpler.
4. Permission "growth" is a role catalog authoring convention, not computed inheritance.

If multi-role were added, required redesign areas would include:

- DB schema (`workspace_memberships` -> join table or array model)
- manifest semantics (precedence / deny overrides / inheritance)
- `workspaceService.resolvePermissions`
- admin APIs/UI
- audit semantics
- realtime topic permission checks

## 4.7 Workspace Admin Role/Permission Control

Primary files:

- `server/domain/workspace/services/admin.service.js`
- `server/modules/workspace/routes/admin.route.js`

Role catalog behavior:

- derived from RBAC manifest via `workspaceRoleCatalog`
- `assignableRoleIds` excludes `owner`

Role mutation rules:

1. `memberUserId` must be valid and active member.
2. `roleId` must be in assignable role list.
3. Cannot change owner role (owner user or existing `owner` role membership).

Admin routes use route-level `permission` config (enforced by `auth.plugin`) for operations like:

- `workspace.settings.view`
- `workspace.settings.update`
- `workspace.roles.view`
- `workspace.members.view`
- `workspace.members.manage`
- `workspace.members.invite`
- `workspace.invites.revoke`
- transcript read/export permissions

## 4.8 Workspace Settings Patch Paths Related To Permissions

Primary file: `server/domain/workspace/policies/workspaceSettingsPatch.js`

User-facing patch fields relevant to access policy:

- `appDenyEmails` -> normalized to `settingsPatch.appSurfaceAccess.denyEmails`
- `appDenyUserIds` -> normalized to `settingsPatch.appSurfaceAccess.denyUserIds`

Validation:

- emails must normalize and match basic email pattern
- user ids must be positive integers

Storage merge path (`workspaceAdminService.updateWorkspaceSettings`):

- merges into `workspace_settings.features_json.surfaceAccess.app`

## 5. Console Permission System (Separate RBAC)

Primary files:

- `server/domain/console/policies/roles.js`
- `server/domain/console/services/consoleAccess.service.js`
- `server/domain/console/services/console.service.js`
- `server/modules/console/routes.js`

## 5.1 Console Roles And Permissions

Defined roles:

1. `console` (non-assignable, wildcard `*`)
2. `devop` (assignable)
3. `moderator` (assignable)

Important console permission groups/constants:

- `CONSOLE_MANAGEMENT_PERMISSIONS`
  - `console.members.view`
  - `console.members.invite`
  - `console.members.manage`
  - `console.invites.revoke`
  - `console.roles.view`
- `CONSOLE_BILLING_PERMISSIONS`
  - `console.billing.events.read_all`
  - `console.billing.catalog.manage`
- `CONSOLE_AI_TRANSCRIPTS_PERMISSIONS`
- `CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS`

## 5.2 Console Access Resolution

`consoleAccess.service` behavior:

1. `ensureInitialConsoleMember(userId)` bootstraps the first active console user as `roleId="console"`.
2. Root identity is persisted via `console_root_identity`.
3. `resolveRequestContext({ user })` returns:
   - `membership`
   - `permissions`
   - `hasAccess`
   - `pendingInvites` (if not active member)
4. `requireConsoleAccess(user)` -> `403` if no active console membership
5. `requirePermission(user, permission)` -> console-specific permission enforcement

Root protection:

- `ensureRootMutationAllowed(actorUser, targetUserId)` blocks non-root actor from mutating root user.

## 5.3 Console Routes: Auth First, Permission In Services

Observation:

- Console routes in `server/modules/console/routes.js` are mostly `auth: "required"` with no route-level `permission`.
- Controller delegates to console services.
- Console services call `requirePermission(...)` internally.

This is intentionally different from workspace admin routes, which rely heavily on route-level permission config + `auth.plugin`.

## 6. Billing Authorization Model (Permissions + Entity Scope)

Primary file: `server/modules/billing/policy.service.js`

This service is the billing authz layer and billable-entity selector resolver.

## 6.1 Key Permission Constant

- `BILLING_MANAGE_PERMISSION = "workspace.billing.manage"`

## 6.2 Selectors (Read/Write Request Resolution)

Billable entity selector precedence:

1. header `x-billable-entity-id`
2. route param `billableEntityId`
3. query `billableEntityId`

Workspace selector precedence:

1. header `x-workspace-slug`
2. route param `workspaceSlug`
3. query `workspaceSlug`

## 6.3 Entity Types

Supported entity types recognized by resolver:

- `workspace`
- `user`
- `organization`
- `external`

Current access behavior:

- `workspace`: supported with membership checks
- `user`: supported, owner-only
- `organization` / `external`: currently forbidden in request resolution flows

## 6.4 Read vs Write Authorization

`resolveBillableEntityForReadRequest(...)`:

- Workspace entity: membership to workspace required (no billing-manage permission required)
- User entity: user must match `ownerUserId`

`resolveBillableEntityForWriteRequest(...)`:

- Workspace entity: membership + `workspace.billing.manage` required
- User entity: owner-only

Failure codes used by billing policy service include:

- `BILLING_WORKSPACE_FORBIDDEN`
- `BILLING_WORKSPACE_SELECTION_REQUIRED`
- `BILLING_ENTITY_FORBIDDEN`
- `BILLING_PERMISSION_REQUIRED`

## 7. Realtime Topic Permissions (Including Billing Limits)

Primary files:

- `shared/realtime/eventTypes.js`
- `shared/realtime/topicRegistry.js`
- `server/realtime/registerSocketIoRealtime.js`
- `src/services/realtime/realtimeRuntime.js`
- `src/services/realtime/realtimeEventHandlers.js`

## 7.1 Topic Registry Rules

`WORKSPACE_BILLING_LIMITS` topic rule:

- `subscribeSurfaces`: `["app", "admin"]`
- `requiredAnyPermissionBySurface`:
  - `app`: `[]` (no extra billing-admin permission)
  - `admin`: `["workspace.billing.manage"]`

Critical implication:

- Any active workspace member on app surface can subscribe to billing limit invalidation events for that workspace (after normal workspace access checks).
- Admin surface still requires billing management permission.

## 7.2 Subscription Authorization Path

On subscribe (`handleSubscribe` in `server/realtime/registerSocketIoRealtime.js`):

1. Validate topic list + supported topic ids.
2. Validate topic allowed for connection surface.
3. Build synthetic subscribe request with `x-surface-id` and `x-workspace-slug`.
4. Call `workspaceService.resolveRequestContext(... workspacePolicy:"required")`.
5. Validate topic permissions against resolved `context.permissions`.
6. Join socket rooms.

Realtime protocol error codes (`shared/realtime/protocolTypes.js`) used for permission/scope failures:

- `unauthorized`
- `forbidden`
- `workspace_required`
- `unsupported_topic`
- `unsupported_surface`

## 7.3 Event Fanout Re-Authorization (Important)

When publishing to subscribed sockets, server re-validates before emitting:

1. surface/topic compatibility
2. authenticated user presence
3. fresh workspace access via `workspaceService.resolveRequestContext(...)`
4. topic permission via `hasTopicPermission(...)`

If authz fails during fanout:

- socket subscription can be evicted (`subscription_evicted` log path)

This prevents stale socket permissions from continuing to receive events after membership/permission changes.

## 7.4 Client Topic Eligibility And Invalidation

Client runtime (`src/services/realtime/realtimeRuntime.js`):

1. Uses shared topic registry to list topics for current surface.
2. Uses `workspaceStore.can(permission)` for permission-gated topics.
3. Subscribes only to eligible topics.

Client event handlers (`src/services/realtime/realtimeEventHandlers.js`):

- `WORKSPACE_BILLING_LIMITS` invalidates:
  - always: `workspaceBillingLimitationsQueryKey(workspaceSlug)`
  - if `changeSource in {purchase_grant, plan_grant}`:
    - `workspaceBillingPlanStateQueryKey(workspaceSlug)`
  - if `changeSource == purchase_grant`:
    - `workspaceBillingPurchasesQueryKey(workspaceSlug)`

## 8. Entitlement Engine: Implemented Definitions, Seeds, And Scope

## 8.1 Seeded Definitions In Backfill Migration

`migrations/20260222232000_backfill_billing_entitlements_engine.cjs` seeds:

1. `projects.max`
   - `entitlement_type = capacity`
   - `unit = project`
   - `enforcement_mode = hard_deny`
   - metadata capability hints: `projects.create`, `projects.unarchive`
2. `deg2rad.calculations.monthly`
   - `entitlement_type = metered_quota`
   - `unit = calculation`
   - `window_interval = month`
   - `window_anchor = calendar_utc`
   - `enforcement_mode = hard_deny`
   - metadata capability hint: `deg2rad.calculate`

## 8.2 Scaffold Nature (Implemented, Not Hypothetical)

Current integrations are intentionally scaffold examples:

- capacity example: `projects.max`
- metered quota example: `deg2rad.calculations.monthly`

The engine is generic; the examples are thin adapters and are expected to be replaceable without changing core entitlement schema/ledger/projection design.

## 9. Entitlement Migrations (DDL + Backfill)

## 9.1 Create Tables Migration

File: `migrations/20260222230000_create_billing_entitlements_engine_tables.cjs`

Notable implementation details:

- Explicit constraint/index names kept short (MySQL 64-char safety)
- `billing_entitlement_balances` uses sentinel defaults for lifetime window columns
- Down migration is irreversible (throws)

Sentinel lifetime constants:

- start: `1970-01-01 00:00:00.000`
- end: `9999-12-31 23:59:59.999`

## 9.2 Backfill/Bootstrap Migration

File: `migrations/20260222232000_backfill_billing_entitlements_engine.cjs`

High-level order:

1. Ensure required tables exist
2. Seed entitlement definitions
3. Backfill/replace plan templates (edge JSON or deterministic defaults)
4. Backfill/replace product templates (edge JSON if present)
5. Seed grants from current plan assignments
6. Seed grants from confirmed purchases
7. Recompute balances for all `billable_entities` and seeded definitions

Down migration: irreversible (throws)

## 9.3 Deterministic Default Plan Templates (Migration Bootstrap)

Defaults used when plan metadata lacks edge entitlement JSON:

- Free/non-paid plan defaults:
  - `projects.max = 3`
  - `deg2rad.calculations.monthly = 100`
- Paid plan defaults:
  - `projects.max = 25`
  - `deg2rad.calculations.monthly = 1000`

Paid-vs-free heuristic in migration:

- Paid plan if `checkout_unit_amount_minor > 0` AND `checkout_provider_price_id` exists
- Else treated like free/default tier for bootstrap

## 9.4 Plan Edge JSON -> Typed Plan Template Transform (Migration)

Migration reads `billing_plans.metadata_json.entitlements[]` if present.

Amount derivation priority (implemented + patched):

1. `entry.amount`
2. `valueJson.amount`
3. `valueJson.limit`
4. `valueJson.max`
5. `valueJson.valueJson.amount`
6. `valueJson.valueJson.limit`
7. `valueJson.valueJson.max`

Why nested candidates exist:

- Migration patch added support for nested `valueJson.valueJson.*` to handle existing payload shapes that wrapped quota objects one level deeper.

Fail-loud conditions include:

- unknown entitlement definition code
- cannot derive positive amount
- invalid duration policy/durationDays combinations
- active plan ends with zero template coverage

## 9.5 Product Edge JSON -> Typed Product Template Transform (Migration)

Migration reads `billing_products.metadata_json.entitlements[]` if present.

Rules:

- `code` required
- `amount` positive integer required
- `grantKind` valid or inferred from `durationDays`
- `timeboxed_addon` requires positive `durationDays`
- `one_off_topup` must not specify `durationDays`

Entitlement-granting product classifier (migration implementation reality):

- product is considered entitlement-granting if:
  - existing typed template rows already exist, OR
  - edge entitlement entries exist in metadata JSON

If classifier says entitlement-granting and final template rows are zero -> migration fails loudly.

## 9.6 Grant Backfill Sources

Plan grants:

- source table: `billing_plan_assignments` with `status="current"`
- source type in grant rows: `plan_assignment`
- dedupe key format: `mig:plan:{assignmentId}:template:{templateId}`

Purchase grants:

- source table: `billing_purchases` with `status="confirmed"`
- product matching by `(provider, providerPriceId)` from purchase `metadata_json`
- source type in grant rows: `billing_purchase`
- dedupe key format: `mig:purchase:{purchaseId}:template:{templateId}`

## 9.7 Balance Backfill Recompute Behavior

Migration recompute implementation specifics:

- `projects.max` consumed count = active `workspace_projects` rows (`status != archived`) for entity's workspace
- all other seeded definitions use consumption ledger sums in window
- `lock_state = "projects_locked_over_cap"` for over-limit `projects.max`, else `"none"`
- `next_change_at` = min(future grant effective_at, future grant expires_at)

## 10. Console Entitlement Authoring (JSON Edge -> Typed Templates)

This is the answer to "So no JSON in the end?"

Correct answer:

- JSON is used at the API/UI authoring edge and for metadata.
- Runtime grant projection and enforcement use typed DB rows.

Primary files:

- `server/modules/console/schema.js`
- `server/domain/console/services/billingCatalog.service.js`
- `server/domain/console/services/consoleBilling.service.js`

## 10.1 Plan Entitlements (Console Edge Contract)

Console plan entitlement JSON shape (validated by schema + service normalizer):

- `code`
- `schemaVersion`
- `valueJson` (object)
- optional `grantKind`
- optional `effectivePolicy`
- optional `durationPolicy`
- optional `durationDays`
- optional `metadataJson`

Validation path:

1. Fastify TypeBox schema validates structural shape.
2. `billingCatalog.service.normalizePlanEdgeEntitlements(...)` validates semantic constraints.
3. `assertEntitlementValueOrThrow(...)` checks `schemaVersion`/`valueJson` against `server/lib/billing/entitlementSchemaRegistry.js`.
4. Amount must be derivable from `valueJson.amount|limit|max`.

Typed persistence:

- `mapPlanEntitlementsToTemplates(...)` resolves `code -> entitlementDefinitionId`
- writes typed rows via `billingRepository.replacePlanEntitlementTemplates(...)`
- console create/update operations are transactional with plan row writes

Update semantics:

- If `entitlements` omitted in update payload: leave templates unchanged
- If `entitlements: []`: clear templates

## 10.2 Product Entitlements (Console Edge Contract)

Console product entitlement JSON shape:

- `code`
- `amount`
- `grantKind` (`one_off_topup` or `timeboxed_addon`)
- `durationDays` (required for timeboxed add-on, absent/null for top-up)
- optional `metadataJson`

Validation path:

1. TypeBox schema
2. `normalizeProductEdgeEntitlements(...)`
3. `mapProductEntitlementsToTemplates(...)` with code->definition resolution

Typed persistence:

- `billingRepository.replaceProductEntitlementTemplates(...)`
- transaction includes product create/update + template replacement

Update semantics:

- omitted `entitlements` -> unchanged
- empty array -> clear product templates

## 10.3 What `metadata_json` Is Used For In Templates

Plan template `metadata_json` stores round-trip context, including:

- `schemaVersion`
- original `valueJson`
- optional nested `metadataJson`

Product template `metadata_json` stores supplemental context (e.g., UI metadata), not authoritative grant amount/duration.

This enables:

- console UI round-trip editing
- audit/debug traceability
- strict runtime enforcement using typed columns

## 10.4 Entitlement Value Schema Registry (`entitlementSchemaRegistry.js`)

Supported schema versions for plan `valueJson` validation:

1. `entitlement.boolean.v1`
2. `entitlement.quota.v1`
3. `entitlement.string_list.v1`

Important note:

- Console plan normalizer still derives typed template `amount` from numeric fields (`amount|limit|max`).
- `schemaVersion` validation ensures edge payload consistency, but runtime plan grants still come from typed template rows after transformation.

## 11. Billing Repository Entitlement API (`server/modules/billing/repository.js`)

## 11.1 Canonical Repository Methods (Entitlements)

Definitions/templates:

- `listEntitlementDefinitions(...)`
- `findEntitlementDefinitionByCode(...)`
- `findEntitlementDefinitionById(...)`
- `listPlanEntitlementTemplates(planId, ...)`
- `replacePlanEntitlementTemplates(planId, templates, ...)`
- `listProductEntitlementTemplates(productId, ...)`
- `replaceProductEntitlementTemplates(productId, templates, ...)`

Ledger writes:

- `insertEntitlementGrant(payload, ...)`
- `insertEntitlementConsumption(payload, ...)`

Projection:

- `findEntitlementBalance(...)`
- `upsertEntitlementBalance(...)`
- `listEntitlementBalancesForSubject(...)`
- `listNextGrantBoundariesForSubjectDefinition(...)`
- `recomputeEntitlementBalance(...)`
- `leaseDueEntitlementBalances(...)`

Capacity helper:

- `resolveCapacityConsumedAmountFromStorage(...)` (scaffold `projects.max` -> count active workspace projects)

## 11.2 Repository Output Field Names (JS Canonical Shape)

Repository mappers normalize DB rows into camelCase objects, e.g.:

- definition: `entitlementType`, `windowInterval`, `enforcementMode`, `metadataJson`
- template: `entitlementDefinitionId`, `grantKind`, `durationPolicy`, `durationDays`
- grant: `effectiveAt`, `expiresAt`, `sourceType`, `dedupeKey`
- consumption: `occurredAt`, `reasonCode`, `usageEventKey`, `dedupeKey`
- balance: `grantedAmount`, `consumedAmount`, `effectiveAmount`, `hardLimitAmount`, `lockState`, `nextChangeAt`, `version`

## 11.3 Idempotent Insert Semantics

### `insertEntitlementGrant(...)`

Requires:

- `dedupeKey`
- `subjectId`
- `entitlementDefinitionId`

Behavior:

1. Check existing row by `dedupe_key`
2. If exists -> `{ inserted: false, grant: existing }`
3. Else insert
4. If race causes duplicate -> fetch existing, return `{ inserted: false, ... }`
5. Else return `{ inserted: true, grant }`

### `insertEntitlementConsumption(...)`

Same pattern as grants, with positive `amount` requirement.

## 11.4 Projection Window Semantics (Repository)

Helpers:

- `resolveCalendarWindow(interval, now)`
- lifetime constants:
  - `1970-01-01T00:00:00.000Z`
  - `9999-12-31T23:59:59.999Z`

Rule:

- If definition has `windowInterval`, use calendar UTC window
- Else use sentinel lifetime window

## 11.5 `recomputeEntitlementBalance(...)` Algorithm (Actual Implementation)

Inputs:

- `subjectId`, `entitlementDefinitionId`
- optional explicit window
- `now`
- optional `capacityConsumedAmount`
- optional `capacityConsumedAmountResolver`

Steps:

1. Load entitlement definition.
2. Resolve window (calendar or lifetime).
3. Sum active grants:
   - `effective_at <= now`
   - `expires_at is null OR expires_at > now`
4. Compute `consumedAmount`:
   - if capacity:
     - use injected resolver if provided
     - else explicit `capacityConsumedAmount`
     - else storage-based scaffold resolver (`projects.max` active project count)
   - else:
     - sum `billing_entitlement_consumptions.amount` in `[windowStartAt, windowEndAt)`
5. Derive:
   - `effectiveAmount = granted - consumed`
   - `hardLimitAmount = granted` for `capacity`/`metered_quota`, else null
   - `overLimit`:
     - `balance`: `effectiveAmount < 0`
     - others: `consumedAmount > grantedAmount`
   - `lockState`:
     - `projects.max` over limit -> `projects_locked_over_cap`
     - else `"none"`
6. Compute `nextChangeAt` from next future grant effective/expiry boundary.
7. Upsert projection row (`version` increments on conflict merge).

## 11.6 `leaseDueEntitlementBalances(...)` Worker Leasing Semantics

Behavior:

- selects balances with `next_change_at <= now`
- orders by `next_change_at`
- applies `FOR UPDATE` if supported
- applies `SKIP LOCKED` if supported
- returns normalized balance rows

This supports multi-worker safe boundary processing.

## 12. Billing Service Entitlement Engine (`server/modules/billing/service.js`)

## 12.1 Canonical Capability -> Limitation Mapping

File: `server/modules/billing/appCapabilityLimits.js`

Current map:

1. `projects.create` -> `projects.max`
   - `usageAmount = 1`
   - `reasonCode = "project.create"`
   - `entitlementType = "capacity"`
2. `projects.unarchive` -> `projects.max`
   - `usageAmount = 1`
   - `reasonCode = "project.unarchive"`
   - `entitlementType = "capacity"`
3. `deg2rad.calculate` -> `deg2rad.calculations.monthly`
   - `usageAmount = 1`
   - `reasonCode = "deg2rad.calculate"`
   - `entitlementType = "metered_quota"`

Do not scatter limitation code literals across domain modules when capability mapping exists.

## 12.2 `resolveEffectiveLimitations(...)` (Service)

Behavior (actual implementation):

1. Loads active entitlement definitions (optionally filtered by codes).
2. For each definition:
   - reads previous balance (for change comparisons/internal use)
   - recomputes current balance immediately via repository
3. Returns normalized limitations payload with:
   - `generatedAt`
   - `stale: false`
   - `limitations[]`

Important implementation note:

- This currently recomputes requested definitions eagerly, not only when `next_change_at <= now`.
- `next_change_at` is still used by worker and targeted refresh paths.

## 12.3 `grantEntitlementsForPlanState(...)`

Purpose: project current plan assignment into grants + recompute balances.

Core behavior:

1. Resolve current plan assignment (`current` status).
2. Load plan and typed plan templates.
3. For each template:
   - validate active definition
   - resolve `effectiveAt` from assignment period start
   - resolve `expiresAt` via template duration policy
   - create deterministic dedupe key:
     - `plan_assignment:{assignmentId}:template:{templateId}:subject:{billableEntityId}`
   - insert grant idempotently
   - recompute balance
   - compare material change (`granted/consumed/effective/hardLimit/overLimit/lockState/nextChangeAt`)
4. Return `changedCodes`
5. Publish realtime (`changeSource = "plan_grant"`) unless `publish:false`

## 12.4 `grantEntitlementsForPurchase(...)`

Purpose: project confirmed purchase into grants + recompute balances.

Product resolution strategy (service implementation):

1. Try explicit `purchase.metadataJson.billingProductId` / `productId`
2. Else resolve by provider + providerPriceId from purchase metadata and product catalog
3. Load typed product templates
4. For each template:
   - resolve grant window (`timeboxed_addon` uses `durationDays`, top-up no expiry)
   - deterministic dedupe key:
     - `purchase:{purchaseId}:template:{templateId}:subject:{billableEntityId}`
   - insert grant idempotently
   - recompute balance and collect changed codes
5. Publish realtime (`changeSource = "purchase_grant"`) unless `publish:false`

## 12.5 `refreshDueLimitationsForSubject(...)`

Purpose: recompute selected or due balances for one billable entity.

Modes:

1. Explicit definitions/codes provided -> force recompute those definitions
2. No explicit definitions -> load balances for subject and only recompute rows with `nextChangeAt <= now`

Publishes realtime if `changedCodes` non-empty and `publish !== false`.

Default change source commonly used:

- `boundary_recompute` (worker)
- `manual_refresh` (manual/domain-triggered refresh)

## 12.6 `consumeEntitlement(...)`

Purpose: write a consumption row (idempotent) + recompute affected balance.

Requires:

- `billableEntityId`
- `limitationCode`
- positive `amount`

Dedupe key priority implemented:

1. `usageEventKey` -> `usage:{entityId}:{definitionId}:{usageEventKey}`
2. `operationKey` -> `op:{entityId}:{definitionId}:{operationKey}:{reasonCode}`
3. fallback request-based -> `req:{entityId}:{definitionId}:{requestId}:{reasonCode}`

If limitation definition missing:

- throws `BILLING_LIMIT_NOT_CONFIGURED` (`409`)

## 12.7 `executeWithEntitlementConsumption(...)` (Transactional Wrapper)

This is the main entitlement enforcement wrapper for domain actions.

Inputs:

- `request`, `user` (for billable-entity resolution)
- `capability` and/or `limitationCode`
- `amount`
- `usageEventKey`
- `operationKey`
- `requestId`
- `metadataJson`
- `access`: `read|write` (defaults to write)
- `capacityResolvers` map
- `action({ trx, billableEntity, limitationCode, capability, limitation, now })`

Behavior:

1. Resolve billable entity using billing policy service (read/write variant).
2. Resolve capability mapping.
3. If no limitation is resolved:
   - executes `action(...)` without billing enforcement.
4. Else run one DB transaction:
   1. `resolveEffectiveLimitations(...)` (fresh recompute)
   2. Locate limitation
   3. Enforce:
      - capacity -> `BILLING_CAPACITY_LOCKED` (`409`) when `used + requested > cap`
      - metered/balance -> `BILLING_LIMIT_EXCEEDED` (`429`) when `effective < requested`
   4. Execute domain `action(...)` with same `trx`
   5. If metered/balance:
      - `consumeEntitlement(...)` (idempotent)
      - post-commit realtime source = `consumption`
   6. If capacity:
      - recompute again (`resolveEffectiveLimitations(...)`) using capacity resolver
      - no consumption row write in scaffold v1
5. Commit
6. Publish billing limits realtime post-commit
7. Return `actionResult` unchanged

## 12.8 Deterministic Billing Limit Error Contracts

### `BILLING_LIMIT_EXCEEDED` (Quota/Credits)

Thrown by `buildLimitExceededError(...)` in `billing/service.js`.

HTTP status: `429`

Payload details include:

- `code`
- `limitationCode`
- `billableEntityId`
- `reason`
- `requestedAmount`
- `limit`
- `used`
- `remaining`
- `interval`
- `enforcement`
- `windowEndAt`
- `retryAfterSeconds`

### `BILLING_CAPACITY_LOCKED` (Capacity)

Thrown by `buildCapacityLockedError(...)`.

HTTP status: `409`

Payload details include:

- `code`
- `limitationCode`
- `used`
- `cap`
- `overBy`
- `lockState`
- `requiredReduction`

## 12.9 `getLimitations(...)` API Read Path

Endpoint: `GET /api/billing/limitations`

Flow:

1. Resolve billable entity for read via billing policy service
2. `resolveEffectiveLimitations(...)`
3. Return:
   - `billableEntity`
   - `generatedAt`
   - `stale`
   - `limitations[]` projection-backed fields

Returned limitation fields (service + schema aligned):

- `code`
- `entitlementType`
- `enforcementMode`
- `unit`
- `windowInterval`
- `windowAnchor`
- `grantedAmount`
- `consumedAmount`
- `effectiveAmount`
- `hardLimitAmount`
- `overLimit`
- `lockState`
- `nextChangeAt`
- `windowStartAt`
- `windowEndAt`
- `lastRecomputedAt`

## 13. Entitlement-Related Billing Lifecycle Integrations

## 13.1 Plan State Changes / Plan Worker

Plan state is still sourced from plan assignment tables.

Entitlement grants are a side-effect projection from current plan assignment state.

`billingService.processDuePlanChanges(...)`:

- applies due upcoming plan assignments
- downstream plan-application flows call `grantEntitlementsForPlanState(...)`

Signup promo path (`seedSignupPromoPlan(...)`) also:

- assigns promo plan
- calls `grantEntitlementsForPlanState(... publish:false)`
- publishes `plan_grant` billing limits event after transaction

## 13.2 Confirmed Purchase Webhook Path

Core rule implemented:

- Grant business value on confirmed webhook processing path, not on redirect URL.

Files:

- `server/modules/billing/webhookSubscriptionProjection.service.js`
- `server/modules/billing/webhook.service.js`

Flow (`invoice.paid` path):

1. Webhook translated/verified
2. Purchase row recorded/confirmed (`recordConfirmedPurchaseForInvoicePaid(...)`)
3. `billingService.grantEntitlementsForPurchase(... publish:false, trx)`
4. Projection service pushes `realtimeChanges[]` entry (`purchase_grant`)
5. `webhook.service` publishes realtime after transaction commit

Subscription projection path similarly calls:

- `grantEntitlementsForPlanState(... publish:false, trx)`
- returns `realtimeChanges[]` entry (`plan_grant`)

## 14. Worker Boundary Processing (`billing/workerRuntime.service.js`)

Entitlement boundary tick:

- interval default: `60s` (`entitlementsBoundaryPollSeconds`)
- worker name: `entitlements-boundary`

Actual flow:

1. Start DB transaction
2. Lease due balance rows via `leaseDueEntitlementBalances({ now, limit:100, workerId }, { trx })`
3. Group leased rows by subject -> definition ids
4. `billingService.refreshDueLimitationsForSubject(... publish:false, trx, changeSource:"boundary_recompute")`
5. Collect changed codes per subject
6. Commit
7. Publish realtime per subject using `billingRealtimePublishService` (`changeSource="boundary_recompute"`)

Complexity goal achieved:

- processes due rows only (not global full sweep)

## 15. Realtime Billing Limits Event Contract

Primary files:

- `shared/realtime/eventTypes.js`
- `server/modules/billing/realtimePublish.service.js`
- `src/services/realtime/realtimeEventHandlers.js`

## 15.1 Topic + Event

- Topic: `workspace_billing_limits` (`REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS`)
- Event type: `workspace.billing.limits.updated`

## 15.2 Payload (Published Over Realtime Event Envelope)

`billingRealtimePublishService.publishWorkspaceBillingLimitsUpdated(...)` emits payload:

- `workspaceId`
- `workspaceSlug`
- `changedCodes` (deduped array)
- `changeSource`
- `changedAt` (ISO string)

Supported `changeSource` values:

1. `purchase_grant`
2. `plan_grant`
3. `consumption`
4. `boundary_recompute`
5. `manual_refresh`

Publisher resolves workspace context from billable entity via:

- `billingRepository.findWorkspaceContextForBillableEntity(...)`

If billable entity has no workspace context (e.g., user-scoped entity), workspace billing limits topic publish returns null/no-op.

## 16. Domain Integrations (Scaffold Examples)

## 16.1 Projects (Capacity Example)

Primary file: `server/modules/projects/controller.js`

Capabilities:

- `projects.create`
- `projects.unarchive`

Integration behavior:

1. `create` route uses `executeWithEntitlementConsumption(...)` with capability `projects.create`
2. `update` and `replace` detect `archived -> non-archived` transition and wrap in capability `projects.unarchive`
3. Capacity resolver for `projects.max` uses `projectsService.countActiveForWorkspace(...)`
4. Archive-state transitions that reduce/increase capacity outside wrapper trigger `refreshDueLimitationsForSubject(...)` manually to refresh projection/realtime

Capacity semantics in scaffold v1:

- no consumption row writes for capacity
- consumed count comes from active project count (`status != archived`)

## 16.2 DEG2RAD Calculator (Metered Quota Example)

Primary file: `server/modules/deg2rad/controller.js`

Capability:

- `deg2rad.calculate`

Integration behavior:

1. Validates/normalizes DEG2RAD input.
2. Wraps calculation + history append in `executeWithEntitlementConsumption(...)`.
3. Uses `usageEventKey` from `Idempotency-Key` or `x-command-id`.
4. Writes consumption only after action callback succeeds in same transaction.

Atomicity support:

- `server/modules/history/service.js` passes `options` through to repository
- `server/modules/history/repository.js` supports optional `trx`
- `server/runtime/controllers.js` injects `billingService` into deg2rad controller

Result:

- calculation history append + quota consumption are atomic
- retries with same usage key dedupe consumption

## 17. Billing Routes + Permission/Entitlement Boundaries

Primary files:

- `server/modules/billing/routes.js`
- `server/modules/billing/controller.js`

Pattern:

1. Billing routes are `auth: "required"` and `workspacePolicy: "optional"` (except webhooks).
2. Billing controller is transport-only (parses, calls service, returns response).
3. Billing policy service handles billable entity selection + authz.
4. Billing service handles entitlement logic.

Webhooks are special:

- `auth: "public"`
- `workspacePolicy: "none"`
- `csrfProtection: false`
- raw body signature verification is required in webhook service/provider adapter.

Idempotency headers required for specific write endpoints:

- checkout/portal/payment-links/plan-change (enforced in controller via `requireIdempotencyKey(...)`)

## 18. Client-Facing Permission + Entitlement State

## 18.1 Workspace Bootstrap / Selection Payloads

Workspace bootstrap and selection paths populate client store with:

- `membership` (`roleId`, `status`)
- `permissions` (explicit array)
- `workspaceSettings` (public subset)
- active workspace info

Client permission check helper:

- `workspaceStore.can(permission)` returns true if permission is empty, wildcard present, or exact permission exists.

## 18.2 Workspace Billing View Freshness Model

Primary file: `src/views/workspace-billing/useWorkspaceBillingView.js`

Current behavior:

1. Queries:
   - plan state
   - products
   - limitations
   - purchases
2. `limitations` query polls every 30s (`refetchInterval: 30000`)
3. Local billing actions call explicit `refresh()` (`refetch()` on plan state, purchases, limitations)
4. Cross-tab/cross-user freshness also uses realtime topic invalidation

This means same-tab freshness is currently achieved via explicit refetches + polling, while cross-tab freshness is via realtime invalidation.

## 19. Invariants (Machine-Useful Rules)

Treat these as hard assumptions unless code changes.

### 19.1 Permission Invariants

1. Workspace membership has one `roleId` (no multi-role support).
2. Console membership has one `roleId` (unique per user).
3. `owner` workspace role is non-assignable and always wildcard.
4. Console `console` role is singleton-active via generated-column uniqueness.
5. Route-level permission checks only run after auth + workspace context resolution.
6. Realtime subscriptions and fanout both enforce topic permission checks.

### 19.2 Entitlement Invariants

1. Grants and consumptions are append-only runtime ledgers (idempotent inserts by `dedupe_key`).
2. `billing_entitlement_balances` is derived state, not source of truth.
3. Runtime grants come from typed templates, not raw plan/product metadata blobs.
4. Confirmed purchase webhooks can grant entitlements; redirect URLs must not.
5. Capacity scaffold path (`projects.max`) does not write consumption rows.
6. Metered/balance paths write consumption rows idempotently.
7. Worker boundary processing is incremental (`next_change_at`), not a global full sweep.

## 20. Non-Invariants / Things To Re-Check Before Assuming

These may change and should be verified in code for future work.

1. Exact set of entitlement definitions seeded by migrations
2. Default plan template amounts used by migration bootstrap
3. Console role permission lists
4. Topic registry rules and app/admin surface permission differences
5. Billing limitation UI polling intervals
6. Which domains are currently integrated with `executeWithEntitlementConsumption(...)`

## 21. "Multiple Roles Per User?" Design Discussion Snapshot (Current System Reality)

This system currently chooses single-role memberships for both workspace and console.

Why this is a sane choice here:

1. Simpler audit trails (one role change event == one effective permission set change)
2. No precedence/conflict logic
3. Cleaner UI/API contracts (`roleId` scalar everywhere)
4. Realtime and route authz stay deterministic

Important nuance:

- "Best practice says one role per user and permissions grow upward" is only partially true.
- The real best practice is deterministic authorization semantics.
- This repo achieves that with single-role + explicit permission lists.
- The upward-growth pattern is a convention of current role definitions, not a built-in inheritance system.

## 22. File Map (Source Of Truth By Concern)

### 22.1 Workspace Permissions / RBAC

- `shared/auth/rbac.manifest.json`
- `server/lib/rbacManifest.js`
- `server/fastify/registerApiRoutes.js`
- `server/fastify/auth.plugin.js`
- `server/domain/workspace/services/workspace.service.js`
- `server/domain/workspace/lookups/workspaceRequestContext.js`
- `server/domain/workspace/policies/workspaceAccess.js`
- `server/domain/workspace/policies/workspaceRoleCatalog.js`
- `server/domain/workspace/policies/workspaceSettingsPatch.js`
- `server/surfaces/appSurface.js`
- `server/surfaces/adminSurface.js`
- `server/surfaces/index.js`
- `server/modules/workspace/routes/admin.route.js`
- `server/modules/workspace/routes/selfService.route.js`
- `server/modules/workspace/controller.js`

### 22.2 Console Permissions

- `server/domain/console/policies/roles.js`
- `server/domain/console/services/consoleAccess.service.js`
- `server/domain/console/services/console.service.js`
- `server/modules/console/routes.js`
- `server/modules/console/controller.js`

### 22.3 Billing Authz / Entity Scope (Permission-Adjacent)

- `server/modules/billing/policy.service.js`
- `docs/billing/contracts.md`

### 22.4 Entitlement Schema / Backfill

- `migrations/20260222230000_create_billing_entitlements_engine_tables.cjs`
- `migrations/20260222232000_backfill_billing_entitlements_engine.cjs`
- `consumable.md` (design blueprint)
- `consumable-coding.md` (execution prompt used to implement)

### 22.5 Entitlement Runtime

- `server/modules/billing/repository.js`
- `server/modules/billing/service.js`
- `server/modules/billing/appCapabilityLimits.js`
- `server/modules/billing/realtimePublish.service.js`
- `server/modules/billing/workerRuntime.service.js`
- `server/modules/billing/webhookSubscriptionProjection.service.js`
- `server/modules/billing/webhook.service.js`
- `server/modules/billing/purchaseLedgerProjection.utils.js`
- `server/modules/billing/schema.js`
- `server/modules/billing/routes.js`
- `server/modules/billing/controller.js`

### 22.6 Entitlement Authoring (Console Edge JSON -> Typed Templates)

- `server/modules/console/schema.js`
- `server/domain/console/services/billingCatalog.service.js`
- `server/domain/console/services/consoleBilling.service.js`
- `server/lib/billing/entitlementSchemaRegistry.js`

### 22.7 Realtime + Client Freshness

- `shared/realtime/eventTypes.js`
- `shared/realtime/topicRegistry.js`
- `shared/realtime/protocolTypes.js`
- `server/realtime/registerSocketIoRealtime.js`
- `server/fastify/realtime/subscribeContext.js`
- `src/features/workspaceAdmin/queryKeys.js`
- `src/services/realtime/realtimeRuntime.js`
- `src/services/realtime/realtimeEventHandlers.js`
- `src/views/workspace-billing/useWorkspaceBillingView.js`
- `src/stores/workspaceStore.js`

### 22.8 Scaffold Domain Integrations

- `server/modules/projects/controller.js`
- `server/modules/projects/service.js`
- `server/modules/projects/repository.js`
- `server/modules/deg2rad/controller.js`
- `server/modules/history/service.js`
- `server/modules/history/repository.js`
- `server/runtime/controllers.js`
- `server/runtime/services.js`

## 23. Sequence Summaries (Text Form)

### 23.1 Workspace Admin Route Permission Check

1. Route registered with `workspacePolicy="required"`, `workspaceSurface="admin"`, `permission="workspace.members.manage"`
2. `auth.plugin` authenticates user
3. `workspaceService.resolveRequestContext(...)` resolves active workspace + membership + permissions for admin surface
4. `auth.plugin` enforces route permission
5. Controller runs
6. Service performs business validation (assignable role, owner immutability)

### 23.2 `executeWithEntitlementConsumption(...)` (Metered Case)

1. Resolve billable entity for write
2. Resolve capability -> limitation code + reason + amount
3. Begin DB transaction
4. Recompute limitation balance
5. Enforce quota
6. Run domain mutation callback with `trx`
7. Insert consumption row idempotently
8. Recompute balance
9. Commit
10. Publish `workspace_billing_limits` realtime event (`changeSource="consumption"`)

### 23.3 Webhook `invoice.paid` -> Purchase Grant

1. Verify webhook signature and normalize event
2. Lock/create webhook event row
3. Route to invoice projection
4. Record confirmed purchase (idempotent purchase dedupe)
5. `grantEntitlementsForPurchase(... publish:false, trx)`
6. Collect `realtimeChanges[]`
7. Mark webhook event processed
8. Commit transaction
9. `webhook.service` publishes realtime changes post-commit

### 23.4 Entitlements Boundary Worker Tick

1. Lease due balance rows with `next_change_at <= now`
2. Group by billable entity + definition ids
3. Refresh due limitations for each subject inside transaction (`publish:false`)
4. Commit
5. Publish one realtime event per changed subject (`changeSource="boundary_recompute"`)

## 24. Prompting Guidance For Future Agents (Use This To Avoid Bad Assumptions)

When changing permissions:

1. Check both workspace RBAC and console RBAC; they are separate.
2. Verify route-level permission enforcement vs service-level enforcement path.
3. Re-check realtime topic permissions and fanout re-auth rules.
4. Do not assume multi-role support exists.

When changing entitlements:

1. Keep typed template tables as runtime source-of-truth.
2. Preserve append-only idempotent ledger semantics.
3. Preserve webhook-confirmed grant semantics.
4. Preserve transactional wrapper correctness for `enforce -> action -> consume/recompute`.
5. Update realtime invalidation (`changeSource`) and client query-key wiring together.
6. Distinguish scaffold behavior from core engine behavior in docs and code comments.

When answering "is JSON still used?":

- Yes at the console/API edge and in metadata/audit fields.
- No as the authoritative runtime source for grant projection/enforcement.
