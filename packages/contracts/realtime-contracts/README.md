# `@jskit-ai/realtime-contracts`

Shared realtime protocol and topic-catalog mechanics for SaaS apps.

This package gives you a stable, reusable core for:

1. Realtime protocol constants (message types + error codes).
2. Building topic catalogs in a normalized and immutable way.
3. Deciding whether a topic is valid for a given surface.
4. Resolving permission requirements per topic/surface.
5. Checking whether a user can subscribe to a topic.

It is intentionally app-agnostic.

It does not define your app's topic names, event names, permission strings, or surfaces.

---

## 1) What This Package Is For

Use this package when you have multiple SaaS apps and you want realtime subscription rules to behave consistently across all of them.

Practical value:

1. Your server subscription guard logic and your client subscription planner can use the same mechanics.
2. Rule normalization is centralized (trim/lowercase/deduplicate/freeze), so each app does not re-implement it differently.
3. Upgrades are easier: improve catalog behavior in one package and roll it out app-by-app.

What stays app-local:

1. Topic vocabulary (`"projects"`, `"chat"`, etc.).
2. Event vocabulary (`"workspace.project.created"`, etc.).
3. Permission vocabulary (`"projects.read"`, `"workspace.billing.manage"`, etc.).
4. Surface vocabulary (`"app"`, `"admin"`, `"console"`, etc.).

---

## 2) Installation (Workspace Monorepo)

In app `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/realtime-contracts": "0.1.0"
  }
}
```

Then install from repo root:

```bash
npm install
```

---

## 3) Core Idea

You bring the vocabulary, package brings the mechanics.

Example app catalog definition:

```js
import { createTopicCatalog } from "@jskit-ai/realtime-contracts";

export const REALTIME_TOPICS = Object.freeze({
  PROJECTS: "projects",
  CHAT: "chat",
  WORKSPACE_BILLING_LIMITS: "workspace_billing_limits"
});

export const REALTIME_TOPIC_REGISTRY = createTopicCatalog({
  [REALTIME_TOPICS.PROJECTS]: {
    subscribeSurfaces: ["app", "admin"],
    requiredAnyPermission: ["projects.read"]
  },
  [REALTIME_TOPICS.CHAT]: {
    subscribeSurfaces: ["app"],
    requiredAnyPermission: ["chat.read"]
  },
  [REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS]: {
    subscribeSurfaces: ["app", "admin"],
    requiredAnyPermission: [],
    requiredAnyPermissionBySurface: {
      app: [],
      admin: ["workspace.billing.manage"]
    }
  }
});
```

---

## 4) Full API Reference

Imports:

```js
import {
  REALTIME_MESSAGE_TYPES,
  REALTIME_ERROR_CODES,
  createTopicCatalog,
  listTopics,
  getTopicRule,
  isSupportedTopic,
  isTopicAllowedForSurface,
  listTopicsForSurface,
  resolveRequiredPermissions,
  hasTopicPermission
} from "@jskit-ai/realtime-contracts";
```

### `REALTIME_MESSAGE_TYPES`

Protocol message type constants:

1. `SUBSCRIBE`
2. `SUBSCRIBED`
3. `UNSUBSCRIBE`
4. `UNSUBSCRIBED`
5. `PING`
6. `PONG`
7. `EVENT`
8. `ERROR`

Real example:

```js
if (payload.type === REALTIME_MESSAGE_TYPES.SUBSCRIBE) {
  // run subscribe flow
}
```

Why this matters:
You avoid hardcoded string drift (`"subscrbe"` typos) across server/client.

### `REALTIME_ERROR_CODES`

Standard protocol error code constants:

1. `INVALID_MESSAGE`
2. `UNAUTHORIZED`
3. `FORBIDDEN`
4. `UNSUPPORTED_TOPIC`
5. `UNSUPPORTED_SURFACE`
6. `WORKSPACE_REQUIRED`
7. `PAYLOAD_TOO_LARGE`
8. `INTERNAL_ERROR`

Real example:

```js
return {
  type: REALTIME_MESSAGE_TYPES.ERROR,
  code: REALTIME_ERROR_CODES.FORBIDDEN,
  message: "Forbidden."
};
```

Why this matters:
Client-side handling can key off code values safely, independent of message wording.

### `createTopicCatalog(definition)`

Builds and returns a normalized, immutable topic catalog object.

Input:
`definition` must be an object keyed by topic name.

Rule shape per topic:

1. `subscribeSurfaces: string[]` (optional)
2. `requiredAnyPermission: string[]` (optional)
3. `requiredAnyPermissionBySurface: Record<string, string[]>` (optional)

Behavior:

1. Throws if `definition` is not an object (or is an array).
2. Normalizes topic keys with `trim()`.
3. Drops blank topic keys.
4. Normalizes surfaces with `trim().toLowerCase()`.
5. Normalizes permission strings with `trim()`.
6. De-duplicates arrays.
7. Freezes final catalog and rule objects.

Real example:

```js
const messyDefinition = {
  " projects ": {
    subscribeSurfaces: [" APP ", "admin", "admin", " "],
    requiredAnyPermission: ["projects.read", " projects.read ", ""],
    requiredAnyPermissionBySurface: {
      " ADMIN ": ["workspace.billing.manage", "workspace.billing.manage", " "],
      "   ": ["dropped.for.blank.surface"]
    }
  }
};

const catalog = createTopicCatalog(messyDefinition);
```

Normalized output/result:

```js
{
  projects: {
    subscribeSurfaces: ["app", "admin"],
    requiredAnyPermission: ["projects.read"],
    requiredAnyPermissionBySurface: {
      admin: ["workspace.billing.manage"]
    }
  }
}
```

`catalog` is deeply frozen at the top level/topic-rule level, so mutation is prevented:

```js
Object.isFrozen(catalog); // true
Object.isFrozen(catalog.projects); // true
Object.isFrozen(catalog.projects.subscribeSurfaces); // true
Object.isFrozen(catalog.projects.requiredAnyPermissionBySurface); // true
```

Why this matters:
Every app gets identical normalization semantics and immutable catalogs by default.

### `listTopics(catalog)`

Returns all topic names in the catalog (`string[]`).

Behavior:

1. Returns `[]` when catalog is null/invalid.

Real example:

```js
const topics = listTopics(catalog);
// e.g. ["projects", "chat", "workspace_billing_limits"]
```

Why this matters:
Useful for diagnostics, tooling, and startup validation.

### `getTopicRule(catalog, topicValue)`

Returns the rule object for a topic, or `null` if missing.

Behavior:

1. `topicValue` is normalized with `trim()`.
2. Empty topic => `null`.

Real example:

```js
const rule = getTopicRule(catalog, " chat ");
// => { subscribeSurfaces: [...], requiredAnyPermission: [...], ... } or null
```

Why this matters:
Single place to safely query topic metadata.

### `isSupportedTopic(catalog, topicValue)`

Returns `true` if the topic exists in catalog.

Real example:

```js
if (!isSupportedTopic(catalog, incomingTopic)) {
  return { code: REALTIME_ERROR_CODES.UNSUPPORTED_TOPIC };
}
```

Why this matters:
Server can reject unknown topics early with explicit protocol errors.

### `isTopicAllowedForSurface(catalog, topicValue, surfaceValue)`

Returns whether a known topic is allowed for a given surface.

Behavior:

1. Unknown topic => `false`.
2. Blank/invalid surface => `false`.
3. If `subscribeSurfaces` is empty => allowed on all surfaces.
4. Surface comparison is lowercased (`"Admin"` == `"admin"`).

Real example:

```js
isTopicAllowedForSurface(catalog, "workspace_members", "admin"); // true
isTopicAllowedForSurface(catalog, "workspace_members", "app");   // false
```

Why this matters:
You can enforce surface segmentation (`admin` topics not visible in `app` surface).

### `listTopicsForSurface(catalog, surfaceValue)`

Returns all topics allowed for the provided surface.

Real example:

```js
const adminTopics = listTopicsForSurface(catalog, "admin");
// e.g. ["projects", "workspace_members", "workspace_settings", ...]
```

Why this matters:
Client runtime can subscribe only to eligible topics for active surface.

### `resolveRequiredPermissions(catalog, topicValue, surfaceValue)`

Returns the effective permission list required for a topic on a surface.

Resolution order:

1. If `requiredAnyPermissionBySurface[surface]` exists, use it.
2. Else use `requiredAnyPermission`.
3. If none exists, returns `[]`.

Real example:

```js
resolveRequiredPermissions(catalog, "workspace_billing_limits", "app");
// => []

resolveRequiredPermissions(catalog, "workspace_billing_limits", "admin");
// => ["workspace.billing.manage"]
```

Why this matters:
Supports nuanced policy where same topic has different rules per surface.

### `hasTopicPermission(catalog, topicValue, permissions, surfaceValue = "")`

Returns whether the provided permission set can subscribe to a topic.

Behavior:

1. Unsupported topic => `false`.
2. If required permissions resolve to empty list => `true`.
3. Supports wildcard `*` in `permissions`.
4. Permission strings are trimmed before comparison.

Real example:

```js
hasTopicPermission(catalog, "chat", ["chat.read"], "app");  // true
hasTopicPermission(catalog, "chat", ["chat.write"], "app"); // false
hasTopicPermission(catalog, "chat", ["*"], "app");          // true
```

Why this matters:
Server-side subscribe authorization can be expressed as one deterministic call.

---

## 5) How Apps Use This In Real Terms (and Why)

### Server path

In realtime server code, use:

1. `REALTIME_MESSAGE_TYPES` / `REALTIME_ERROR_CODES` for protocol payloads.
2. `isSupportedTopic`, `isTopicAllowedForSurface`, `hasTopicPermission` for subscribe checks.

In this repo that happens via app shims consumed by:

1. `apps/jskit-value-app/server/realtime/registerSocketIoRealtime.js`

Why:
Server is the enforcement point, so all subscribe decisions must be deterministic and centralized.

### Client path

In client runtime, use:

1. `listRealtimeTopicsForSurface` for topic eligibility by surface.
2. `getTopicRule` when local permission checks need topic metadata.

In this repo:

1. `apps/jskit-value-app/src/platform/realtime/realtimeRuntime.js`

Why:
Client avoids noisy invalid subscriptions and keeps behavior aligned with server model.

### App-local vocabulary ownership

Keep constants local to app:

1. `apps/jskit-value-app/shared/eventTypes.js` (topics/events vocabulary)
2. `apps/jskit-value-app/shared/topicRegistry.js` (app-specific rules)

Why:
This prevents shared package from becoming app-specific and hard to reuse.

---

## 6) Recommended Integration Pattern

1. Define app topics/events in app-local constants.
2. Build app catalog with `createTopicCatalog`.
3. Export app-local helper wrappers if you want stable app API names.
4. Use wrappers in server/client runtime code.
5. Keep protocol constants sourced from package everywhere.

This gives you:

1. Shared mechanics.
2. App-level control over policy vocabulary.
3. Safe future extraction without massive import churn.

---

## 7) Common Mistakes To Avoid

1. Putting app-specific topic/event strings into this package.
2. Duplicating topic-permission logic manually in runtime code instead of calling helpers.
3. Using inconsistent surface casing (`"Admin"` vs `"admin"`) without normalization.
4. Assuming empty surface should pass checks. It does not.
5. Mutating catalog objects at runtime. They are intentionally frozen.

---

## 8) Troubleshooting

### "Topic is unexpectedly unsupported"

Check:

1. Topic key in app definition has no whitespace issues.
2. Topic exists in the catalog passed to helper.
3. You are not querying a different topic name constant than what you registered.

### "Admin can subscribe, app cannot (or vice versa)"

Check:

1. `subscribeSurfaces` for the topic.
2. `requiredAnyPermissionBySurface` override entries.
3. Caller surface normalization before checks.

### "Permission checks always fail"

Check:

1. `permissions` is an array of strings.
2. Expected permission exactly matches required value.
3. You are passing the right surface when per-surface overrides exist.

---

## 9) Short End-to-End Example

```js
import {
  REALTIME_MESSAGE_TYPES,
  REALTIME_ERROR_CODES,
  createTopicCatalog,
  isSupportedTopic,
  isTopicAllowedForSurface,
  hasTopicPermission
} from "@jskit-ai/realtime-contracts";

const catalog = createTopicCatalog({
  chat: {
    subscribeSurfaces: ["app"],
    requiredAnyPermission: ["chat.read"]
  }
});

function authorizeSubscribe({ topic, surface, permissions }) {
  if (!isSupportedTopic(catalog, topic)) {
    return {
      ok: false,
      payload: { type: REALTIME_MESSAGE_TYPES.ERROR, code: REALTIME_ERROR_CODES.UNSUPPORTED_TOPIC }
    };
  }

  if (!isTopicAllowedForSurface(catalog, topic, surface)) {
    return {
      ok: false,
      payload: { type: REALTIME_MESSAGE_TYPES.ERROR, code: REALTIME_ERROR_CODES.UNSUPPORTED_SURFACE }
    };
  }

  if (!hasTopicPermission(catalog, topic, permissions, surface)) {
    return {
      ok: false,
      payload: { type: REALTIME_MESSAGE_TYPES.ERROR, code: REALTIME_ERROR_CODES.FORBIDDEN }
    };
  }

  return { ok: true };
}
```

---

## 10) Export Summary

From `@jskit-ai/realtime-contracts`:

1. `REALTIME_MESSAGE_TYPES`
2. `REALTIME_ERROR_CODES`
3. `createTopicCatalog`
4. `listTopics`
5. `getTopicRule`
6. `isSupportedTopic`
7. `isTopicAllowedForSurface`
8. `listTopicsForSurface`
9. `resolveRequiredPermissions`
10. `hasTopicPermission`
