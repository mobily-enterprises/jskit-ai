# `@jskit-ai/rbac-core`

Shared RBAC manifest normalization and permission-check helpers for SaaS apps.

This package is app-agnostic:

1. It does not define your role IDs.
2. It does not define your permission strings.
3. It does not query your database.

## Installation (workspace)

```json
{
  "dependencies": {
    "@jskit-ai/rbac-core": "0.1.0"
  }
}
```

From monorepo root:

```bash
npm install
```

## API

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

## Example

```js
const manifest = normalizeManifest({
  defaultInviteRole: "member",
  roles: {
    owner: { assignable: false, permissions: ["*"] },
    member: { assignable: true, permissions: ["projects.read", "projects.write"] }
  }
});

const permissions = resolveRolePermissions(manifest, "member");
const canWrite = hasPermission(permissions, "projects.write");
```

## Notes

1. Empty `permission` checks pass (`hasPermission(set, "") === true`).
2. Wildcard (`"*"`) grants every permission.
3. `normalizeManifest` enforces an `owner` role with wildcard permissions.
