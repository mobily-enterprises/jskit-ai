# @jskit-ai/surface-routing

Shared routing primitives for multi-surface apps (for example: `app`, `admin`, `console`) with consistent prefix handling and workspace-aware path helpers.

## What this package is for

Use this package when an app has more than one UI surface and each surface may have:

- its own URL prefix (like `/admin` or `/console`)
- its own API prefix routing behavior
- shared canonical route names (login, workspaces, account settings, invitations)
- workspace-scoped routes (`/w/:workspaceSlug/...`)

It gives one consistent way to:

- normalize and validate surface ids
- resolve the surface from a browser/API pathname
- build prefixed routes safely
- extract workspace slug from a pathname

## What this package is not for

- No HTTP server code.
- No client router setup by itself.
- No auth policy decisions.
- No product-specific route guards.

## Exports

- `@jskit-ai/surface-routing`
  - `createSurfaceRegistry`
  - `createSurfacePathHelpers`

## API reference

## `createSurfaceRegistry(options)`

Creates a normalized, frozen surface registry from a `surfaces` object.

### Input

- `options.surfaces` (required): object of surface definitions.
- `options.defaultSurfaceId` (optional): preferred default surface id.

Each surface definition supports:

- `id`
- `prefix` (for example `""`, `/admin`, `/console`)
- `requiresWorkspace` (boolean)

### Internal helper: `normalizePrefix(prefixLike)`

- Normalizes prefix text:
  - guarantees one leading slash for non-empty prefixes
  - removes duplicate slashes
  - removes trailing slash
  - maps `/` to empty prefix
- Real-life example:
  - input `"admin//"` becomes `"/admin"` so route matching stays deterministic.

### Returned members

- `SURFACE_REGISTRY`
  - Frozen normalized registry map keyed by normalized surface id.
  - Example: app startup can inspect exact configured surfaces.
- `DEFAULT_SURFACE_ID`
  - Effective default surface id.
  - Example: unknown path falls back to this surface.
- `normalizeSurfaceId(value)`
  - Returns known normalized id or default id.
  - Example: `" Admin "` becomes `"admin"`.
- `resolveSurfacePrefix(surfaceId)`
  - Returns configured prefix for a surface.
  - Example: `"console"` -> `"/console"`.
- `surfaceRequiresWorkspace(surfaceId)`
  - Returns whether the surface is workspace-scoped.
  - Example: can decide if workspace selection is required for that surface.
- `listSurfaceDefinitions()`
  - Returns normalized surface definitions.
  - Example: UI can show all available surfaces in a selector or admin diagnostics.

## `createSurfacePathHelpers(options)`

Creates path helper functions using a registry from `createSurfaceRegistry`.

### Required inputs

- `defaultSurfaceId`
- `normalizeSurfaceId` function
- `resolveSurfacePrefix` function
- `listSurfaceDefinitions` function

### Optional route config

- `routes.loginPath` (default `/login`)
- `routes.resetPasswordPath` (default `/reset-password`)
- `routes.workspacesPath` (default `/workspaces`)
- `routes.accountSettingsPath` (default `/account/settings`)
- `routes.invitationsPath` (default `/invitations`)
- `routes.workspaceBasePath` (default `/w`)

### Core returned helpers

- `normalizePathname(pathname)`
  - Cleans path (`query/hash removed`, leading slash ensured, trailing slash normalized).
  - Example: `admin/w/acme/?tab=1` -> `/admin/w/acme`.
- `matchesPathPrefix(pathname, prefix)`
  - Checks exact prefix match or child route match.
  - Example: `/api/admin/projects` matches `/api/admin`.
- `resolveSurfaceFromApiPathname(pathname)`
  - Resolves surface for API routes; defaults if API path has no explicit prefixed surface.
  - Example: `/api/admin/workspace/list` -> `admin`.
- `resolveSurfaceFromPathname(pathname)`
  - Resolves surface from browser path first, with API-aware behavior.
  - Example: `/console/errors` -> `console`.
- `resolveSurfacePrefix(surface)`
  - Reads prefix for a surface id via registry.
- `withSurfacePrefix(surface, path)`
  - Adds correct prefix to a route path.
  - Example: `("admin", "/login")` -> `/admin/login`.
- `createSurfacePaths(surface)`
  - Returns a full path helper object for one surface (details below).
- `resolveSurfacePaths(pathname?)`
  - Creates helper object for the current pathname (browser pathname when available).
  - Example: in browser runtime, route helpers automatically use active surface.

### Internal helper behavior inside `paths.js`

These functions are internal (not exported directly) but useful to understand behavior:

- `normalizeWorkspaceSuffix(suffix)`
  - Normalizes workspace path suffix and guarantees leading slash.
  - Example: `"projects"` becomes `"/projects"` so `workspacePath` does not generate malformed paths.
- `escapeRegExp(value)`
  - Escapes special regex characters before building workspace slug matcher.
  - Example: surface prefixes like `/admin` are safely embedded in regex.
- `normalizeSurface(surface)` (inside `createSurfacePathHelpers`)
  - Delegates to registry normalization so unknown ids fall back safely.
- `prefixedSurfaceDefinitions()` (inside `createSurfacePathHelpers`)
  - Lists only prefixed surfaces and sorts by longest prefix first.
  - Example: avoids ambiguous matches when one prefix is a prefix of another.

### `createSurfacePaths(surface)` returned members

Path values:

- `surface`, `prefix`, `rootPath`
- `loginPath`
- `resetPasswordPath`
- `workspacesPath`
- `accountSettingsPath`
- `invitationsPath`

Path builder functions:

- `workspacePath(workspaceSlug, suffix = "/")`
  - Builds workspace-scoped path.
  - Example: `workspacePath("acme", "/projects")` -> `/w/acme/projects` (or prefixed variant).
- `workspaceHomePath(workspaceSlug)`
  - Shortcut for workspace home path.
  - Example: `workspaceHomePath("acme")` -> `/w/acme`.

Path check functions:

- `isPublicAuthPath(pathname)` -> true for login/reset routes.
- `isLoginPath(pathname)` -> login route check.
- `isResetPasswordPath(pathname)` -> reset route check.
- `isWorkspacesPath(pathname)` -> workspaces list route check.
- `isAccountSettingsPath(pathname)` -> account settings route check.
- `isInvitationsPath(pathname)` -> invitations route check.

Extractor:

- `extractWorkspaceSlug(pathname)`
  - Pulls workspace slug from route when present.
  - Example: `/admin/w/acme/projects` -> `"acme"`.

## How it is used in apps (real terms, and why)

Current `jskit-value-app` usage:

- `apps/jskit-value-app/shared/routing/surfaceRegistry.js`
  - defines concrete surfaces (`app`, `admin`, `console`) via `createSurfaceRegistry`.
- `apps/jskit-value-app/shared/routing/surfacePaths.js`
  - creates shared path helpers via `createSurfacePathHelpers`.

Why this matters in real product behavior:

- The same rules resolve surface from both page routes and API routes.
- Prefix-safe path generation avoids broken links when moving between surfaces.
- Workspace slug extraction is centralized, so features like API transport context and error reporting can map route to correct surface/workspace reliably.

Practical example flow:

1. User is on `/admin/w/acme/settings`.
2. App resolves surface as `admin`.
3. Route helper builds account path with prefix (`/admin/account/settings`).
4. Workspace slug `acme` is extracted consistently for related features.
