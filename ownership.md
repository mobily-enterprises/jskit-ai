# Ownership Contract (v0)

## Core Rule

Surface topology is defined once in `config/public.js` under `config.surfaceDefinitions`.
Every layer consumes that contract. No layer redefines it.

## Canonical Surface Contract

Each `config.surfaceDefinitions.<id>` entry contains only:

- `id`
- `pagesRoot`
- `enabled`
- `requiresAuth`
- `requiresWorkspace`

`prefix` is removed.
`routeBase` is derived from `pagesRoot` (never authored in config).

## Derivation Rules

- `pagesRoot: ""` -> `routeBase: "/"`
- `pagesRoot: "console"` -> `routeBase: "/console"`
- `pagesRoot: "w/[workspaceSlug]"` -> `routeBase: "/w/:workspaceSlug"`
- Generic conversion: `[param]` -> `:param`

## Ownership by Module

### `kernel`

Owns generic surface mechanics only:

- normalization of surface ids/pages roots
- `pagesRoot -> routeBase` derivation
- compiled surface route matching (including dynamic segments)
- metadata-first route filtering with inherited surface metadata

Does **not** own tenancy policy or workspace business logic.

### `shell-web`

Owns shell runtime only:

- shell layout components/outlets/error runtime
- placement context shape
- generic surface link resolution (surface id + params map)

Does **not** own workspace URL grammar or tenancy policy.

### `users-core`

Owns tenancy/workspace policy:

- tenancy semantics (`none`, `personal`, `workspace`)
- workspace-aware surface policy (`requiresWorkspace`)
- workspace surfaces config mutation (`app`, `admin`) when tenancy enables it
- workspace provisioning and API behavior rules

### `users-web`

Owns workspace web scaffolding and UI:

- installs workspace wrappers/pages for `app` and `admin` surfaces
- installs workspace/admin feature pages under those surfaces
- consumes generic surface contract + users workspace helpers

### `create-app`

Plumbing only:

- optional `tenancyMode` seed in config
- seeds base surfaces (`home`, `console`) with `pagesRoot`
- does not implement multihome logic

## Descriptor Installation Contract

Packages that write under `src/pages` must use surface targeting:

- `toSurface`
- `toSurfacePath` (under `src/pages/<pagesRoot>/...`)
- `toSurfaceRoot` (writes wrapper at `src/pages/<pagesRoot>.vue`)

Hardcoded `src/pages/admin/...` or similar paths are forbidden for surface-owned files.

## Routing Metadata Rule

Annotate only surface root wrappers with:

- `meta.jskit.surface`

Children inherit nearest ancestor surface metadata.

## Placement Note

Placement topology is unchanged in this iteration.
Next iteration will introduce destination surface + generic destination point mapping.
