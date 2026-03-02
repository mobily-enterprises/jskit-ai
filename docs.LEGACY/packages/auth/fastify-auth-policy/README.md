# `@jskit-ai/fastify-auth-policy`

Reusable Fastify auth/policy plumbing for SaaS APIs.

Plain-language summary:
This package is the shared enforcement engine for route auth policy in Fastify. It handles the repeated mechanics (CSRF hook, auth pre-handler flow, owner checks, permission checks, request decorators). Your app still owns business policy and identity details (how auth works, how workspace context is resolved, what permissions mean).

---

## Table Of Contents

1. [What This Package Is For](#1-what-this-package-is-for)
2. [What This Package Does Not Do](#2-what-this-package-does-not-do)
3. [Beginner Glossary](#3-beginner-glossary)
4. [Install](#4-install)
5. [Public API](#5-public-api)
6. [Function Reference: `authPolicyPlugin`](#6-function-reference-authpolicyplugin)
7. [Function Reference: `withAuthPolicy`](#7-function-reference-withauthpolicy)
8. [Function Reference: `mergeAuthPolicy`](#8-function-reference-mergeauthpolicy)
9. [How Apps Use This In Real Terms (And Why)](#9-how-apps-use-this-in-real-terms-and-why)
10. [End-To-End App Example](#10-end-to-end-app-example)
11. [Troubleshooting](#11-troubleshooting)
12. [Common Mistakes](#12-common-mistakes)

---

## 1) What This Package Is For

Use this package when multiple apps need the same Fastify auth enforcement mechanics.

It centralizes reusable behavior:

1. Route metadata-driven auth policy checks.
2. CSRF enforcement on unsafe methods.
3. Request decoration (`request.user`, `request.workspace`, `request.membership`, `request.permissions`).
4. `public` / `required` / `own` policy flow.
5. Permission guard flow that uses injected permission checker.
6. Policy denial callback hook for observability.

Real-world value:

1. You avoid copy-pasting auth pre-handler boilerplate across apps.
2. You keep route policy behavior consistent across teams/services.
3. Fixes in policy plumbing are made once, then reused by all apps.

---

## 2) What This Package Does Not Do

This package intentionally does not:

1. Verify JWT/session tokens by itself.
2. Query DB memberships by itself.
3. Define your permission vocabulary (`"projects.read"`, etc.).
4. Define your workspace model.
5. Define app-specific denial analytics schema.

Why this matters:

1. Shared package stays app-agnostic.
2. App business policy stays explicit and injectable.

---

## 3) Beginner Glossary

1. **Auth policy**: route rule for identity checks (`public`, `required`, `own`).
2. **Owner policy (`own`)**: request user must match resource owner id.
3. **Workspace context**: active workspace + membership + permissions for a request.
4. **Permission check**: verifies user can do a specific action.
5. **CSRF**: server-side protection against cross-site request forgery.
6. **Pre-handler**: Fastify hook that runs before route handler.

---

## 4) Install

In app workspace `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/fastify-auth-policy": "0.1.0"
  }
}
```

Then install from monorepo root:

```bash
npm install
```

---

## 5) Public API

```js
import {
  authPolicyPlugin,
  withAuthPolicy,
  mergeAuthPolicy
} from "@jskit-ai/fastify-auth-policy";
```

Public functions:

1. `authPolicyPlugin(deps, options)`
2. `withAuthPolicy(meta)`
3. `mergeAuthPolicy(routeOptions, meta)`

---

## 6) Function Reference: `authPolicyPlugin`

Signature:

```js
const registerPolicyPlugin = authPolicyPlugin(deps, options);
await registerPolicyPlugin(fastify);
```

### What it does

Creates and installs a reusable Fastify pre-handler auth policy runtime.

Under the hood it:

1. Registers `@fastify/cookie`.
2. Registers `@fastify/rate-limit` with provided options.
3. Registers `@fastify/csrf-protection`.
4. Decorates request fields.
5. Adds pre-handler policy enforcement for API routes.

### `deps` (required and optional callbacks)

#### `resolveActor(request, reply, meta)` (required)

What it does:

1. Performs app-specific authentication.
2. Returns normalized auth result.

Expected return shape:

```js
{
  authenticated: true,
  actor: { id: 7, email: "user@example.com" },
  transientFailure: false
}
```

Practical real-life example:

1. Read auth cookie/session from request.
2. Call your auth service.
3. If service says session should be refreshed, write cookies on `reply`.
4. Return `authenticated` and `actor`.

#### `resolveContext({ request, actor, meta })` (optional)

What it does:

1. Resolves workspace context when route policy asks for it.

Expected return shape:

```js
{
  workspace: { id: 11, slug: "acme" },
  membership: { roleId: "admin", status: "active" },
  permissions: ["projects.read", "projects.write"]
}
```

Practical real-life example:

1. If `meta.workspacePolicy` is `required`, resolve selected workspace.
2. Resolve role/membership for current user.
3. Return effective permissions for the route permission guard.

#### `hasPermission({ permission, permissions, request, actor, context, meta })` (required)

What it does:

1. Decides if route permission requirement is satisfied.

Practical real-life example:

```js
function hasPermission({ permission, permissions }) {
  return permissions.includes("*") || permissions.includes(permission);
}
```

Real scenario:

1. Route requires `workspace.members.manage`.
2. Context permissions are `['workspace.members.view']`.
3. This function returns `false`, route gets `403 Forbidden`.

#### `onPolicyDenied(event)` (optional)

What it does:

1. Receives denial events (reason + status + request/meta context).
2. Good place to record auth failure metrics.

Practical real-life example:

```js
function onPolicyDenied(event) {
  observability.recordAuthFailure({
    reason: event.reason,
    statusCode: event.statusCode
  });
}
```

### `options`

#### `nodeEnv` (optional)

Used for CSRF secure cookie flag (`secure: true` in production).

Real example:

```js
{ nodeEnv: process.env.NODE_ENV }
```

#### `rateLimitPluginOptions` (optional)

Passed to `@fastify/rate-limit` registration.

Real example:

```js
{
  rateLimitPluginOptions: {
    global: false
  }
}
```

#### `apiPrefix` (optional, default `"/api/"`)

Only routes under this prefix are enforced by this pre-handler.

Real example:

1. `/health` bypasses auth policy.
2. `/api/workspace/projects` is enforced.

#### `unsafeMethods` (optional)

Methods that trigger CSRF enforcement when route has CSRF enabled.

Default: `POST`, `PUT`, `PATCH`, `DELETE`.

#### `resolveCsrfToken` (optional)

Custom CSRF token resolver.

Default checks these headers in order:

1. `csrf-token`
2. `x-csrf-token`
3. `x-xsrf-token`

#### `csrfCookieOpts` (optional)

Additional cookie settings for CSRF plugin.

#### `createError(status, message)` (optional)

Custom error factory for denied policy branches.

Practical real-life example:

1. App already uses a custom `AppError` class and wants auth policy errors to match that type.

--- 

## 7) Function Reference: `withAuthPolicy`

Signature:

```js
const wrapped = withAuthPolicy(meta);
```

Returns:

```js
{
  config: {
    authPolicy,
    workspacePolicy,
    workspaceSurface,
    permission,
    ownerParam,
    userField,
    ownerResolver,
    csrfProtection
  }
}
```

### What it does

Builds normalized Fastify `config` policy block from route policy metadata.

### Practical real-life example

```js
const routePolicy = withAuthPolicy({
  authPolicy: "required",
  workspacePolicy: "required",
  workspaceSurface: "admin",
  permission: "workspace.settings.update"
});

fastify.route({
  method: "PATCH",
  url: "/api/workspace/settings",
  ...routePolicy,
  handler
});
```

Why useful:

1. Gives one consistent metadata shape.
2. Avoids copy/paste config drift across routes.

---

## 8) Function Reference: `mergeAuthPolicy`

Signature:

```js
const routeOptions = mergeAuthPolicy(baseRouteOptions, meta);
```

### What it does

Merges normalized auth policy metadata into existing route options, preserving existing non-policy config fields.

### Practical real-life example

```js
const routeOptions = mergeAuthPolicy(
  {
    method: "GET",
    url: "/api/workspace/projects",
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute"
      }
    }
  },
  {
    authPolicy: "required",
    workspacePolicy: "required",
    permission: "projects.read"
  }
);

fastify.route({
  ...routeOptions,
  handler
});
```

Why useful:

1. Route-specific settings like `rateLimit` remain intact.
2. Policy defaults are applied consistently.

---

## 9) How Apps Use This In Real Terms (And Why)

Typical pattern in a SaaS app:

1. Keep app auth service local.
2. Keep workspace resolution local.
3. Keep permission vocabulary local.
4. Keep observability mapping local.
5. Use this package only for enforcement mechanics.

In this repo, the app adapter is:

1. `apps/jskit-value-app/server/fastify/auth.plugin.js`

That adapter injects app callbacks:

1. `resolveActor` -> calls app `authService`.
2. `resolveContext` -> calls app `workspaceService`.
3. `hasPermission` -> calls app RBAC helper.
4. `onPolicyDenied` -> calls app observability service.

Why this is positive across many apps:

1. Shared policy plumbing, local business policy.
2. Fewer repeated bugs in auth pre-handler logic.
3. Easier onboarding: new app only implements injected callbacks.

---

## 10) End-To-End App Example

```js
import fp from "fastify-plugin";
import { authPolicyPlugin } from "@jskit-ai/fastify-auth-policy";
import { hasPermission } from "@jskit-ai/rbac-core";

async function authPlugin(fastify, options) {
  const authService = options.authService;
  const workspaceService = options.workspaceService || null;

  if (!authService) {
    throw new Error("authService is required.");
  }

  const registerPolicyPlugin = authPolicyPlugin(
    {
      async resolveActor(request, reply) {
        const authResult = await authService.authenticateRequest(request);

        if (authResult.clearSession) {
          authService.clearSessionCookies(reply);
        }
        if (authResult.session) {
          authService.writeSessionCookies(reply, authResult.session);
        }

        return {
          authenticated: authResult.authenticated,
          actor: authResult.profile || null,
          transientFailure: authResult.transientFailure
        };
      },
      async resolveContext({ request, actor, meta }) {
        if (!workspaceService) {
          return null;
        }

        return workspaceService.resolveRequestContext({
          user: actor,
          request,
          workspacePolicy: meta.workspacePolicy,
          workspaceSurface: meta.workspaceSurface
        });
      },
      hasPermission({ permission, permissions }) {
        return hasPermission(permissions, permission);
      }
    },
    {
      nodeEnv: options.nodeEnv,
      rateLimitPluginOptions: options.rateLimitPluginOptions
    }
  );

  await registerPolicyPlugin(fastify);
}

export default fp(authPlugin);
```

---

## 11) Troubleshooting

1. **`Authentication required.` on protected routes**
Check `resolveActor` return shape and `authenticated` value.

2. **`Authentication service temporarily unavailable.`**
Your `resolveActor` is reporting `transientFailure: true`.

3. **`Route owner could not be resolved.` on `own` routes**
Check `ownerResolver`/`ownerParam` and actor field mapping.

4. **Unexpected `Forbidden.`**
Check `resolveContext` permissions output and `hasPermission` logic.

5. **CSRF failures on POST/PUT/PATCH/DELETE**
Ensure CSRF token and cookie pair are both present.

---

## 12) Common Mistakes

1. Putting app-specific permission strings inside this package.
2. Returning non-normalized actor/context shapes from callbacks.
3. Forgetting to handle session cookie writes in `resolveActor`.
4. Treating route metadata defaults as implicit app policy.
5. Skipping denial telemetry in `onPolicyDenied`.
