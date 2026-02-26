# URL Mount Customization

This document defines how workspace route mounts are customized without patching router composition code.

## Source of Truth

- Config: `apps/jskit-value-app/config/urls.js`
- Resolver: `apps/jskit-value-app/src/framework/composeRouteMounts.js`
- Mount registry: `apps/jskit-value-app/src/framework/routeMountRegistry.js`
- Registry contributions: `apps/jskit-value-app/src/framework/moduleRegistry.js`

## Supported Mount Keys (Current Phase)

- `ai.workspace` (default: `/assistant`)
- `chat.workspace` (default: `/chat`, built-in alias: `/workspace-chat`)
- `social.workspace` (default: `/social`)
- `projects.workspace` (default: `/projects`)

## Override Model

Set `urlMountOverrides` in `config/urls.js`:

```js
export const urlMountOverrides = {
  "social.workspace": "/community",
  "projects.workspace": "/customers"
};
```

Optional extra aliases are set with `urlMountAliasOverrides`:

```js
export const urlMountAliasOverrides = {
  "social.workspace": ["/social"]
};
```

When an override changes a mount path, the previous default path is automatically retained as an alias redirect.

## Validation Rules

Mount composition fails fast when:

- two mount keys resolve to the same path
- any mount resolves to a reserved workspace path
- alias paths collide with reserved paths or another mount path
- route/navigation fragments reference undefined mount keys

## Reserved Workspace Paths

For the `admin`/`app` workspace surfaces, reserved paths are kept for core routes (`/`, `/settings`, `/admin`, `/billing`, `/transcripts`, `/choice-2`).

## Alias Redirect Behavior

Alias routes are explicit redirect routes that preserve `workspaceSlug` and route params where applicable.
Current alias handling covers assistant/chat/social/projects route trees, including project detail/edit deep links.
