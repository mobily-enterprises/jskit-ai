# URL Mount Customization

This document defines how workspace route mounts are customized without patching router composition code.

## Source of Truth

- Config: `apps/jskit-value-app/config/urls.js`
- Resolver: `apps/jskit-value-app/src/framework/composeRouteMounts.js`
- Mount registry: `apps/jskit-value-app/src/framework/routeMountRegistry.js`
- Registry contributions: `apps/jskit-value-app/src/framework/moduleRegistry.js`

## Supported Mount Keys (Current Phase)

- `ai.workspace` (default: `/assistant`)
- `chat.workspace` (default: `/chat`)
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

Only explicit mount overrides are supported. No alias mount configuration or fallback route redirects are applied.

## Validation Rules

Mount composition fails fast when:

- two mount keys resolve to the same path
- any mount resolves to a reserved workspace path
- route/navigation fragments reference undefined mount keys

## Reserved Workspace Paths

For the `admin`/`app` workspace surfaces, reserved paths are kept for core routes (`/`, `/settings`, `/admin`, `/billing`, `/transcripts`, `/choice-2`).

## No Compatibility Layer

Route mount resolution is single-path only for each key. The runtime does not expose legacy mount aliases, compatibility redirects, or fallback route trees.
