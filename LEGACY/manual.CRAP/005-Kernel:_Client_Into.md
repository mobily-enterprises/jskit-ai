# JSKIT Manual: Chapter 5 Kernel Client Intro

This chapter explains the current client composition model after the placement refactor.

The key shift is:

- layout composition is **app-owned** (`src/placement.js`)
- modules contribute **component tokens + context**, not hard-coded page edits
- shell renders by **slot** (`target.region`) and surface

## 1. Mental Model

There are 4 layers:

1. **Layout hosts** (for example `ShellLayout.vue`)
   - Render `<ShellOutlet placement="...">` in each visual region.

2. **App placement registry** (`src/placement.js`)
   - Defines what should appear in each slot.
   - Uses `addPlacement({ id, slot, surface, order, componentToken, props, when })`.

3. **Client container bindings**
   - Providers bind `componentToken -> Vue component`.
   - Example token: `auth.web.profile.widget`.

4. **Placement runtime**
   - Loads app placements.
   - Filters by surface and slot.
   - Evaluates `when(context)`.
   - Resolves `componentToken` from container.
   - Renders via `ShellOutlet`.

## 2. Placement Contract

The placement contract lives in `@jskit-ai/shell-web/client/placement`.

Core fields:

```js
addPlacement({
  id: "unique.id",
  slot: "app.top-right",        // <target>.<region>
  surface: "*",                 // or app/admin/console
  order: 1000,                  // stable ordering
  componentToken: "token.name", // must be bound in client container
  props: {},                    // optional; passed to component
  when: ({ auth, user }) => true // optional
});
```

Important:

- `slot` is normalized and validated.
- duplicate `id` entries are rejected in runtime.
- unknown `componentToken` is skipped with warning (no hard crash).

## 3. Slot Names

`shell-web` defines region names in `WEB_PLACEMENT_REGIONS`:

- `top`
- `top-left`
- `left`
- `bottom-left`
- `bottom`
- `bottom-right`
- `right`
- `top-right`
- `center`
- `primary-menu`
- `secondary-menu`

But rendering is controlled by outlets. Current default shell layout exposes:

- `app.top-left`
- `app.top-right`
- `app.primary-menu`
- `app.secondary-menu`

`auth-web` also exposes a nested outlet:

- `avatar.primary-menu`

A placed component can expose nested slots too (example below: `avatar.primary-menu`).

## 4. App-Owned Registry (`src/placement.js`)

`shell-web` installs this file:

```js
import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement };

// Keep default export near top so installers can append entries below.
export default function getPlacements() {
  return registry.build();
}
```

Design details:

- default export is intentionally near the top.
- module installers append `addPlacement(...)` blocks at the bottom.
- app developers own and edit this file freely.

## 5. Background Runtime Flow (Step-by-Step)

`ShellWebClientProvider` does this during boot:

1. creates `runtime.web-placement.client`
2. dynamically imports `/src/placement.js`
3. reads default export:
   - if function: executes it
   - if array: uses it directly
4. calls `runtime.replacePlacements(...)`
5. injects runtime into Vue app for `ShellOutlet`

Then, each `ShellOutlet` call:

1. asks runtime for placements by `{ surface, slot, context }`
2. runtime merges context contributors from tag `web-placement.context.client`
3. runtime applies `when(context)` filter
4. runtime resolves `componentToken` with `app.make(token)`
5. returns sorted entries for rendering

## 6. Auth Example (How It Actually Works)

### 6.1 What `auth-web` binds

`AuthWebClientProvider` registers:

- `auth.web.profile.widget` -> `AuthProfileWidget`
- `auth.web.profile.menu.link-item` -> `AuthProfileMenuLinkItem`
- `auth.web.placement.context` -> function returning `{ auth, user }`

and tags context contributor with:

- `web-placement.context.client`

### 6.2 What `auth-web` appends to `src/placement.js`

On install, `auth-web` appends:

1. Avatar widget placement:

```js
addPlacement({
  id: "auth.profile.widget",
  slot: "app.top-right",
  surface: "*",
  order: 1000,
  componentToken: "auth.web.profile.widget"
});
```

2. Avatar menu entries (nested slot):

```js
addPlacement({
  id: "auth.profile.menu.open-app",
  slot: "avatar.primary-menu",
  componentToken: "auth.web.profile.menu.link-item",
  props: { label: "Open app", to: "/app" },
  when: ({ auth }) => Boolean(auth?.authenticated)
});
```

### 6.3 How nested slot works

`AuthProfileWidget` is rendered in `app.top-right`.  
Inside it, `AuthProfileWidget` renders:

```vue
<ShellOutlet placement="avatar.primary-menu" :context="placementContext" />
```

So other placements targeting `avatar.primary-menu` appear inside the avatar menu.

### 6.4 Drop entries into auth avatar menu

Quick path (reuse auth-web list item component):

```js
addPlacement({
  id: "app.profile.menu.settings",
  slot: "avatar.primary-menu",
  surface: "*",
  order: 900,
  componentToken: "auth.web.profile.menu.link-item",
  props: {
    label: "Settings",
    to: "/app/settings"
  },
  when: ({ auth }) => Boolean(auth?.authenticated)
});
```

Custom UI path (your own component token):

1. bind your component in a client provider:

```js
app.singleton("app.profile.menu.settings-item", () => AppProfileSettingsMenuItem);
```

2. target the same avatar slot from `src/placement.js`:

```js
addPlacement({
  id: "app.profile.menu.settings-custom",
  slot: "avatar.primary-menu",
  surface: "*",
  order: 900,
  componentToken: "app.profile.menu.settings-item",
  props: {
    dense: true
  }
});
```

Important: placement only renders where an outlet exists.  
`avatar.primary-menu` works because `AuthProfileWidget` contains that `ShellOutlet`.

## 7. Add/Remove Lifecycle (`auth-web`)

### 7.1 Add

```bash
npx jskit add package auth-web
```

Effects:

- installs auth login/signout scaffolds
- appends auth placement block into `src/placement.js`
- binds auth component tokens through client provider

### 7.2 Remove

```bash
npx jskit remove package auth-web
```

Effects:

- removes managed auth files and dependency state
- **does not delete** app-owned placement entries from `src/placement.js`

Why this is intentional:

- app-owned composition file may have user edits
- uninstall must avoid destructive edits

Runtime behavior after remove:

- leftover placement entries referencing missing tokens are skipped
- runtime warns once per missing token

### 7.3 Re-add

Re-adding `auth-web` does not duplicate its placement block.

Mechanism:

- descriptor uses `append-text` with `skipIfContains`
- if marker already exists in `src/placement.js`, mutation is skipped

## 8. How To Add Your Own Placement From `@local/main`

This is the normal extension path for app developers.

### Step A: create a component in app-local package

Example: `packages/main/src/client/views/MainStatusChip.vue`

```vue
<template>
  <v-chip size="small" color="info" variant="tonal" label>Local status</v-chip>
</template>
```

### Step B: bind a component token in a local client provider

Create: `packages/main/src/client/providers/MainClientProvider.js`

```js
import MainStatusChip from "../views/MainStatusChip.vue";

class MainClientProvider {
  static id = "local.main.client";

  register(app) {
    app.singleton("local.main.status-chip", () => MainStatusChip);
  }
}

export { MainClientProvider };
```

### Step C: export provider from local client entrypoint

`packages/main/src/client/index.js`

```js
export { MainClientProvider } from "./providers/MainClientProvider.js";
```

### Step D: add placement in app-owned `src/placement.js`

```js
addPlacement({
  id: "local.main.status-chip",
  slot: "app.top-left",
  surface: "*",
  order: 250,
  componentToken: "local.main.status-chip"
});
```

Optional visibility:

```js
when: ({ auth }) => Boolean(auth?.authenticated)
```

## 9. Mutation Engine Notes (Why This Works)

`jskit-cli` now supports descriptor text mutation:

- `op: "append-text"`
- `position: "top" | "bottom"`
- `skipIfContains` guard(s)

`auth-web` uses this to append placement code blocks safely into `src/placement.js`.

`remove` currently reverts:

- managed files
- `upsert-env` text changes

It intentionally does not revert `append-text` blocks in app-owned files.

## 10. Practical Rules

1. Keep `src/placement.js` as app-owned source of truth.
2. Use token-based placements (`componentToken`), not direct imports of optional modules.
3. Always set stable `id` and `order`.
4. Use `when(context)` for visibility logic.
5. Let modules append entries, but keep final composition under app control.

## 11. Inspecting Placement Surface in CLI

`npx jskit view <package>` now shows placement metadata:

- `Placement outlets (accepted slots)`:
  where a package is receptive to placements.
- `Placement contributions (default entries)`:
  what entries a package installs by default.

Example:

- `npx jskit view shell-web` shows `app.*` outlets.
- `npx jskit view auth-web` shows `avatar.primary-menu` outlet and auth default menu/widget entries.





# Original contents

# JSKIT Manual: Chapter 5 The Client Side

This chapter defines the full client-side coverage scope.

Runnable chapter example packages:

- `docs/examples/05.kernel-client`
- `docs/examples/tut-custom-client-routes-dec`
- `docs/examples/tut-custom-client-routes-prog`

## Scope

- client runtime mental model and lifecycle
- client routing and surface-aware behavior
- client module bootstrapping and route registration
- client-side debugging/errors and practical workflows
- Vite integration for client bootstrap
- shared APIs used by client code

## Client Core APIs (`@jskit-ai/kernel/client`)

- `createClientRuntimeApp`
- `bootClientModules`
- `registerClientModuleRoutes`
- `CLIENT_MODULE_RUNTIME_APP_TOKEN`
- `CLIENT_MODULE_ROUTER_TOKEN`
- `CLIENT_MODULE_VUE_APP_TOKEN`
- `CLIENT_MODULE_ENV_TOKEN`
- `CLIENT_MODULE_SURFACE_RUNTIME_TOKEN`
- `CLIENT_MODULE_SURFACE_MODE_TOKEN`
- `CLIENT_MODULE_LOGGER_TOKEN`

## Client Shell and Routing APIs (`@jskit-ai/kernel/client`)

- `createSurfaceShellRouter`
- `createShellRouter` (alias)
- `createFallbackNotFoundRoute`
- `buildSurfaceAwareRoutes`
- `createShellBeforeEachGuard`
- `AUTH_POLICY_AUTHENTICATED`
- `AUTH_POLICY_PUBLIC`
- `WEB_ROOT_ALLOW_YES`
- `WEB_ROOT_ALLOW_NO`
- `DEFAULT_GUARD_EVALUATOR_KEY`

## Client Bootstrap APIs (`@jskit-ai/kernel/client`)

- `resolveClientBootstrapDebugEnabled`
- `createClientBootstrapLogger`
- `bootstrapClientShellApp`

## Client Vite APIs (`@jskit-ai/kernel/client/vite`)

- `createJskitClientBootstrapPlugin`
- `createVirtualModuleSource`
- `resolveInstalledClientPackageIds`
- `CLIENT_BOOTSTRAP_VIRTUAL_ID`
- `CLIENT_BOOTSTRAP_RESOLVED_ID`

## Shared APIs Used By Client Work (`@jskit-ai/kernel/shared/surface`)

- `createSurfaceRegistry`
- `normalizeSurfaceId`
- `createSurfacePathHelpers`
- `createSurfaceRuntime`
- `filterRoutesBySurface`
- `DEFAULT_SURFACES`
- `DEFAULT_ROUTES`
- `createDefaultAppSurfaceRegistry`
- `createDefaultAppSurfacePaths`

## Practical Topics To Cover With These APIs

- route declaration contract for client modules (`id`, `path`, `component`, `scope`, `surface`)
- how duplicate route names/paths are detected
- how surface filtering changes active routes
- how shell guards are evaluated and how redirects are decided
- how to boot modules before router installation
- how to wire fallback/not-found routes
- how to enable and use client bootstrap debug output
- end-to-end example: add one client module route and verify it appears only on the intended surface
