# Surfaces Contract

## Why

Surfaces control routing, auth/workspace policy, and module file placement.
They must be deterministic and authored once.

## Config Shape

Defined in `config/public.js`:

```js
config.surfaceDefinitions.<surfaceId> = {
  id: "<surfaceId>",
  label: "<display label>",
  pagesRoot: "<filesystem-root-under-src/pages>",
  enabled: true,
  requiresAuth: false,
  requiresWorkspace: false
};
```

## Canonical Fields

- `id`: stable surface id used by runtime and module descriptors.
- `label` (optional): display label for shell UI chips/menu headers.
- `pagesRoot`: canonical topology root.
- `enabled`: runtime inclusion flag.
- `requiresAuth`: default guard policy input.
- `requiresWorkspace`: workspace policy flag (owned by users layer).

No `prefix` field.

## Derived Runtime Field

`routeBase` is derived from `pagesRoot`:

- `""` -> `/`
- `console` -> `/console`
- `w/[workspaceSlug]` -> `/w/:workspaceSlug`
- `w/[workspaceSlug]/admin` -> `/w/:workspaceSlug/admin`

## Base vs Workspace Surfaces

### Scaffold-owned base surfaces

- `home` (`pagesRoot: ""`)
- `console` (`pagesRoot: "console"`)

### Users-owned workspace surfaces

- `app` (`pagesRoot: "w/[workspaceSlug]"`)
- `admin` (`pagesRoot: "w/[workspaceSlug]/admin"`)

Added only when tenancy mode enables workspace routing.

## File Placement

Package descriptors targeting surface pages use:

- `toSurface`
- `toSurfacePath`
- `toSurfaceRoot`

Resolution:

- `toSurface + toSurfacePath` -> `src/pages/<pagesRoot>/<toSurfacePath>`
- `toSurface + toSurfaceRoot` -> `src/pages/<pagesRoot>.vue`

Validation fails for:

- unknown surface id
- disabled target surface
- missing `pagesRoot`
- both `to` and `toSurface`
- path traversal in `toSurfacePath`

## Route Surface Resolution

Order:

1. `meta.jskit.surface`
2. inherited parent route surface
3. derived pathname matcher from `pagesRoot`

This prevents overlap issues between `/` and `/w/:workspaceSlug/...`.
