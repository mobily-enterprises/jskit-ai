# `@jskit-ai/rbac-core`

Shared RBAC manifest normalization and permission-check helpers for SaaS apps.

This package gives you a reusable, app-agnostic RBAC core for:

1. Loading and validating a role/permission manifest.
2. Normalizing role/permission data into deterministic shapes.
3. Resolving effective permission sets per role.
4. Running consistent permission checks in route/service logic.
5. Validating feature flags against declared permission catalogs.

It intentionally does not:

1. Query memberships from a database.
2. Know anything about Fastify, Vue, Socket.IO, or your transport.
3. Define app-specific role IDs or permission strings.

If you are newer to RBAC, use this quick translation:

1. A `role` is a label for a user in a context (example: `owner`, `member`).
2. A `permission` is a specific action the app allows (example: `workspace.members.manage`).
3. A `manifest` is the policy file that says which roles grant which permissions.
4. This package is the policy engine, not the user/membership storage layer.

---

## 1) What This Package Is For

Use this package when multiple apps need the same RBAC mechanics but different policy vocabularies.

Practical value:

1. One normalization path prevents subtle drift between services.
2. Startup validation fails fast when manifest config is broken.
3. Permission checks become predictable and testable.
4. Cross-app upgrades are simple: update one package.

What stays app-local:

1. Role IDs (`owner`, `member`, `staff`, etc.).
2. Permission IDs (`workspace.members.manage`, etc.).
3. Membership resolution (who has which role in which workspace).
4. Route policy decisions (which endpoint requires what).

---

## 2) Installation (Workspace Monorepo)

In app `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/rbac-core": "0.1.0"
  }
}
```

Then install from repo root:

```bash
npm install
```

Quick start (smallest useful flow):

```js
import { loadRbacManifest, resolveRolePermissions, hasPermission } from "@jskit-ai/rbac-core";

const manifest = await loadRbacManifest("./server/auth/rbac.manifest.json");
const permissions = resolveRolePermissions(manifest, "member");
const canManageMembers = hasPermission(permissions, "workspace.members.manage");
```

---

## 3) RBAC Manifest Model

Expected input shape (before normalization):

```js
{
  version: 1,
  defaultInviteRole: "member",
  roles: {
    owner: {
      assignable: false,
      permissions: ["*"]
    },
    member: {
      assignable: true,
      permissions: ["history.read", "history.write"]
    }
  }
}
```

Normalized output includes derived fields:

1. `collaborationEnabled`
2. `assignableRoleIds`
3. Validated/normalized role permissions.

Important invariant:

1. `roles.owner` must exist, must be non-assignable, and must include wildcard `*`.

---

## 4) Full API Reference

Imports:

```js
import {
  OWNER_ROLE_ID,
  createOwnerOnlyManifest,
  loadRbacManifest,
  normalizeManifest,
  resolveRolePermissions,
  hasPermission,
  listManifestPermissions,
  manifestIncludesPermission
} from "@jskit-ai/rbac-core";
```

### `OWNER_ROLE_ID`

Constant owner role identifier.

Plain English:
This is the shared constant for the owner role name (`"owner"`).

Current value:

1. `"owner"`

Real example:

```js
import { OWNER_ROLE_ID } from "@jskit-ai/rbac-core";

if (String(existingMembership.roleId || "") === OWNER_ROLE_ID) {
  throw new Error("Cannot change workspace owner role.");
}
```

Why this matters:
Using one shared owner constant avoids string drift in critical safety rules.

### `createOwnerOnlyManifest()`

Creates a valid owner-only fallback manifest.

Plain English:
Use this when you need a safe fallback policy that only has an owner role.

Return shape:

1. `version: 1`
2. `defaultInviteRole: null`
3. `roles.owner.assignable: false`
4. `roles.owner.permissions: ["*"]`
5. `collaborationEnabled: false`
6. `assignableRoleIds: []`

Real example:

```js
import { createOwnerOnlyManifest } from "@jskit-ai/rbac-core";

const emergencyManifest = createOwnerOnlyManifest();
// useful fallback for local/dev bootstrap when collaboration is intentionally disabled
```

Why this matters:
You can keep runtime behavior safe even when collaboration roles are unavailable.

### `loadRbacManifest(manifestPath)`

Reads a JSON manifest from disk, parses it, then normalizes it with `normalizeManifest`.

Plain English:
Read policy file from disk and convert it into a validated runtime object.

Behavior:

1. Throws if file cannot be read.
2. Throws if file is not valid JSON.
3. Returns normalized manifest object.

Real example:

```js
import { loadRbacManifest } from "@jskit-ai/rbac-core";

const RBAC_MANIFEST = await loadRbacManifest(appConfig.rbacManifestPath);
```

In this repo, server startup uses this flow at:

1. `apps/jskit-value-app/server.js`

Why this matters:
RBAC config errors fail fast at startup instead of causing inconsistent runtime authorization.

### `normalizeManifest(rawManifest)`

Validates and normalizes raw manifest input.

Plain English:
Clean and verify your raw manifest so the rest of the app can trust it.

Behavior:

1. Requires object input; throws otherwise.
2. Normalizes role IDs with `trim()`. Blank role IDs are dropped.
3. Normalizes each role object.
4. Coerces `assignable` to boolean.
5. Normalizes role permissions to trimmed/non-empty/unique string array.
6. Ensures `owner` role exists (auto-created if absent).
7. Enforces owner invariants (`assignable` must be `false` and permissions must include `*`).
8. Computes `assignableRoleIds` from non-owner assignable roles.
9. Resolves `defaultInviteRole` only when it points to an assignable role.
10. Computes `collaborationEnabled` only when assignable roles exist and a valid assignable default invite role exists.
11. Normalizes `version` to integer; defaults to `1`.

Messy input example:

```js
const rawManifest = {
  version: "2",
  defaultInviteRole: "member",
  roles: {
    " owner ": {
      assignable: false,
      permissions: ["*", "*", "workspace.settings.update"]
    },
    member: {
      assignable: 1,
      permissions: ["history.read", " history.read ", "history.write", ""]
    },
    viewer: {
      assignable: 0,
      permissions: ["history.read"]
    }
  }
};

const manifest = normalizeManifest(rawManifest);
```

Normalized result (conceptually):

```js
{
  version: 2,
  defaultInviteRole: "member",
  collaborationEnabled: true,
  assignableRoleIds: ["member"],
  roles: {
    owner: { assignable: false, permissions: ["*", "workspace.settings.update"] },
    member: { assignable: true, permissions: ["history.read", "history.write"] },
    viewer: { assignable: false, permissions: ["history.read"] }
  }
}
```

Why this matters:
Every app gets the same manifest cleanup and safety guarantees.

### `resolveRolePermissions(manifest, roleId)`

Returns effective permission list for one role.

Plain English:
Given a role ID, return the exact permission strings that role has.

Behavior:

1. Normalizes `roleId` with `trim().toLowerCase()`.
2. Special-cases owner role -> returns `["*"]`.
3. Unknown/missing role -> returns `[]`.
4. Returned permissions are trimmed and deduplicated.

Real example:

```js
const permissions = resolveRolePermissions(manifest, membership.roleId);

if (!permissions.includes("*") && !permissions.includes("workspace.members.view")) {
  throw new Error("Forbidden.");
}
```

What `membership.roleId` usually looks like in real apps:

1. It is a plain string from membership data (often a DB `role_id` column).
2. Typical values: `"owner"`, `"member"`, `"viewer"`, `"admin"`.
3. It must match a key in `manifest.roles` (for example, `manifest.roles.member`).

In this repo this style is used in workspace access resolution:

1. `apps/jskit-value-app/server/domain/workspace/services/workspace.service.js`

Why this matters:
Role-to-permission mapping stays deterministic across modules.

### `hasPermission(permissionSet, permission)`

Checks whether a permission set satisfies a required permission.

Plain English:
Answer one question: "Does this user have this permission?"

Behavior:

1. Empty/blank required permission -> `true`.
2. Non-array `permissionSet` -> `false` (unless required permission is blank).
3. Wildcard `*` grants all permissions.
4. Exact permission match grants access.

Real example:

```js
if (routePermission && !hasPermission(request.permissions, routePermission)) {
  throw new Error("Forbidden.");
}
```

In this repo this is the auth route guard pattern:

1. `apps/jskit-value-app/server/fastify/auth.plugin.js`

Why this matters:
Route and service permission checks stay simple and consistent.

### `listManifestPermissions(manifest, options?)`

Lists all declared permission IDs in sorted order.

Plain English:
Give me every permission this manifest declares, useful for diagnostics and validation.

Signature:

```js
listManifestPermissions(manifest, { includeOwner = false } = {});
```

Behavior:

1. Iterates all manifest roles.
2. Skips owner role unless `includeOwner` is `true`.
3. Excludes wildcard `*`.
4. Returns deduplicated sorted permission IDs.

Real example:

```js
const knownPermissions = listManifestPermissions(rbacManifest, { includeOwner: false });
// use in startup diagnostics or config error hints
```

In this repo startup validation uses the output for actionable errors:

1. `apps/jskit-value-app/server.js`

Why this matters:
Operators get clear diagnostics instead of generic "permission missing" failures.

### `manifestIncludesPermission(manifest, permission, options?)`

Checks whether a permission is declared anywhere in the manifest.

Plain English:
Check whether a permission exists in current policy at all before enforcing it.

Signature:

```js
manifestIncludesPermission(manifest, permission, { includeOwner = false } = {});
```

Behavior:

1. Empty/blank `permission` -> `true`.
2. Scans roles (optionally skipping owner).
3. Returns `true` if any role contains exact permission.
4. Returns `true` if scanned role contains wildcard `*`.
5. Otherwise returns `false`.

Real example:

```js
const shouldEnforce = manifestIncludesPermission(rbacManifest, "chat.read", { includeOwner: true });

if (!shouldEnforce) {
  // permission is not part of current manifest policy, skip check in this deployment
}
```

In this repo this pattern is used in chat workspace access checks:

1. `apps/jskit-value-app/server/modules/chat/service.js`

Why this matters:
Feature behavior can adapt safely to manifest-defined policy in each deployment.

---

## 5) How Apps Use This In Real Terms (and Why)

### Startup and config validation

Typical flow:

1. Resolve RBAC manifest path from env/config.
2. Load + normalize manifest at startup using `loadRbacManifest`.
3. Validate feature-required permissions with `manifestIncludesPermission`.
4. Emit known permission hints with `listManifestPermissions` on config errors.

In this repo:

1. `apps/jskit-value-app/server.js`

Why:
Misconfiguration is caught before serving traffic.

### Route-level authorization

Typical flow:

1. Request context resolves current user membership permissions.
2. Route metadata declares required permission.
3. Guard enforces with `hasPermission`.

In this repo:

1. `apps/jskit-value-app/server/fastify/auth.plugin.js`

Why:
One helper keeps every route check semantically aligned.

### Workspace context and effective permissions

Typical flow:

1. Membership provides role ID.
2. Service resolves role permission set using `resolveRolePermissions`.
3. Result is attached to request/workspace context.

In this repo:

1. `apps/jskit-value-app/server/domain/workspace/services/workspace.service.js`

Why:
All downstream modules read one normalized permission set.

### Domain-specific policy toggles

Typical flow:

1. Domain checks if permission exists in deployment manifest.
2. If present, enforce; if absent, skip to preserve backward compatibility.

In this repo:

1. `apps/jskit-value-app/server/modules/chat/service.js`

Why:
Policy can evolve by manifest content without hard-coding deployment assumptions.

---

## 6) Recommended Integration Pattern

1. Keep manifest JSON in app config (`config/` or `shared/auth/`).
2. Load once at process startup with `loadRbacManifest`.
3. Pass normalized manifest into runtime services via dependency injection.
4. Resolve role permissions in one place per request context.
5. Use `hasPermission` in route/domain guards, not ad-hoc string checks.
6. Use `manifestIncludesPermission` + `listManifestPermissions` for startup sanity checks.

This gives you:

1. Stable permission semantics.
2. Better diagnostics.
3. Lower coupling between app policy and framework code.

---

## 7) Common Mistakes To Avoid

1. Using mixed-case role IDs in manifest keys.
2. Duplicating permission-check logic instead of using `hasPermission`.
3. Treating wildcard `*` as a literal permission name in UI.
4. Assuming `defaultInviteRole` is always preserved; it is nulled if not assignable.
5. Forgetting owner invariants (`assignable: false`, includes `*`).

---

## 8) Troubleshooting

### "RBAC manifest must be a JSON object."

Cause:

1. Manifest file content is not a JSON object root (or input to `normalizeManifest` is invalid).

Check:

1. Top-level JSON is `{ ... }`, not array/string/null.

### "roles.owner must be non-assignable" or `permissions must include "*"`

Cause:

1. Owner role violates package invariants.

Check:

1. `roles.owner.assignable === false`
2. `roles.owner.permissions` includes `*`

### Route permission checks always fail

Cause candidates:

1. Context permission list is empty.
2. Required permission string has mismatch/typo.
3. Role ID in membership does not match manifest role key convention.

Check:

1. `resolveRolePermissions(manifest, membership.roleId)` output.
2. Route metadata permission string.
3. Manifest role key casing/normalization.

### Feature-required permission fails at startup

Cause:

1. App config references permission not declared in manifest roles.

Check:

1. `manifestIncludesPermission(manifest, required, { includeOwner: false })`
2. `listManifestPermissions(manifest, { includeOwner: false })` output.

---

## 9) Short End-to-End Example

```js
import {
  loadRbacManifest,
  resolveRolePermissions,
  hasPermission,
  manifestIncludesPermission,
  listManifestPermissions
} from "@jskit-ai/rbac-core";

const manifest = await loadRbacManifest("./server/auth/rbac.manifest.json");

const aiRequiredPermission = "workspace.ai.use";
if (!manifestIncludesPermission(manifest, aiRequiredPermission, { includeOwner: false })) {
  const known = listManifestPermissions(manifest, { includeOwner: false });
  throw new Error(`AI permission "${aiRequiredPermission}" missing. Known: ${known.join(", ")}`);
}

function authorizeWorkspaceRoute({ roleId, requiredPermission }) {
  const permissions = resolveRolePermissions(manifest, roleId);
  return hasPermission(permissions, requiredPermission);
}

authorizeWorkspaceRoute({ roleId: "member", requiredPermission: "workspace.settings.view" });
```

---

## 10) Export Summary

From `@jskit-ai/rbac-core`:

1. `OWNER_ROLE_ID`
2. `createOwnerOnlyManifest`
3. `loadRbacManifest`
4. `normalizeManifest`
5. `resolveRolePermissions`
6. `hasPermission`
7. `listManifestPermissions`
8. `manifestIncludesPermission`
