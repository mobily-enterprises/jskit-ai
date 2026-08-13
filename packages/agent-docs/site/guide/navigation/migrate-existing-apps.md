# Migrate an existing app

Use this guide when upgrading an application to JSKIT destination-stack navigation. Version 0 is a clean cutover: there is no compatibility mode, no legacy return-query reader, and no second Back system. Update the app and remove the old navigation code in the same change.

## 1. Wire the one runtime

Keep the exact `RouterHistory` passed to Vue Router, enable navigation in `createShellRouter()`, and pass the returned runtime into bootstrap:

```js
const routerHistory = createWebHistory();
const { router, navigation, fallbackRoute } = createShellRouter({
  createRouter,
  history: routerHistory,
  routes,
  surfaceRuntime,
  surfaceMode,
  navigation: true
});

await bootstrapClientShellApp({
  createApp,
  rootComponent: App,
  router,
  navigation,
  bootClientModules: bootInstalledClientModules,
  surfaceRuntime,
  surfaceMode,
  fallbackRoute
});
```

Do not create another runtime, rediscover browser history, or write `history.state` in application code.

## 2. Classify every committed route

Every route that can become visible must explicitly declare `meta.jskit.navigation`:

| Existing screen | Behavior | Required identity |
| --- | --- | --- |
| List, dashboard, calendar, settings root, meaningful record view | `destination` | `destinationKey` |
| New, edit, short wizard step, routed dialog or sheet | `preserve` | `machineryKey` |
| Auth callback, sign-out transition, sensitive ownerless flow | `boundary` | normally `persistence.mode: "none"` |

Example destination:

```vue
<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "admin",
      "navigationRole": "detail",
      "navigation": {
        "behavior": "destination",
        "destinationKey": "admin.inventory.view",
        "fallback": { "name": "admin-inventory" },
        "scope": ["principal", "workspace", "surface"],
        "persistence": { "mode": "snapshot", "queryAllowlist": ["q", "status"] }
      }
    }
  }
}
</route>
```

Example edit machinery:

```js
definePage({
  meta: {
    jskit: {
      navigation: {
        behavior: "preserve",
        machineryKey: "admin.inventory.edit",
        persistence: { mode: "url-only", queryAllowlist: [] }
      }
    }
  }
});
```

Redirect-only route owners that never commit do not need a frame. Do not infer behavior from `--navigation-role`; product-menu placement and chronological stack behavior are separate. Generated routes retain the product-link decision in sibling `meta.jskit.navigationRole`, which is for inspection and placement tooling, never stack classification.

## 3. Keep navigation as real links

Replace record click handlers with `JskitDestinationLink`:

```vue
<script setup>
import { JskitDestinationLink } from "@jskit-ai/kernel/client/navigationLink";
</script>

<template>
  <JskitDestinationLink :to="{ name: 'admin-inventory-view', params: { recordId } }">
    {{ recordName }}
  </JskitDestinationLink>
</template>
```

It renders an anchor and intercepts only an ordinary primary click. Modified clicks, new tabs, copy-link, and context menus stay native. Generated CRUD pages already use this link and route Save/Cancel through the shared machinery exit.

## 4. Let the shell own Back and primary navigation

Remove page-owned Back arrows, teleports, and app-bar CSS positioning. `ShellLayout` consumes the runtime and renders one Vuetify leading control:

- Back when an immediate in-app predecessor or declared fallback exists;
- menu when primary navigation is toggleable;
- no redundant control when permanent navigation is visible.

Use the same `shell.primary-nav` and `shell.secondary-nav` placements. Shell-web renders them as compact `VBottomNavigation`, medium rail-mode `VNavigationDrawer`, and expanded permanent `VNavigationDrawer`, including the shell-owned More overflow when necessary.

## 5. Move state to the right owner

- Keep shareable filters, search, sort, tabs, dates, pages, and cursors in path/query/hash.
- Register navigation contributors for expanded ids, virtual-list windows, stable item anchors and offsets, and focus keys.
- Use `useCrudListNavigationContributor()` for generated CRUD lists.
- Use `useCrudFormNavigationBlocker()` for unsaved generated or custom forms.
- Never persist form bodies, tokens, passwords, API payloads, or arbitrary stores as navigation state.

See [State restoration](/guide/navigation/restoration) for contributor ordering and readiness barriers.

## 6. Delete the old stack

Remove all application code whose purpose was to simulate in-app chronology:

- `returnTo`, `returnUrl`, `returnSource`, `returnScroll`, `restoreScroll`, or nested `from` query chains;
- local context-navigation services/composables;
- `router.back()`, `history.back()`, or `history.length` used by page chrome;
- hard-coded parent pushes and URL-segment trimming;
- page-level Back controls and shell teleports;
- direct `history.pushState()` or `history.replaceState()` calls.

An approved, validated authentication return target is a separate one-time auth concern. It must not become the application's destination stack.

## 7. Inspect and verify the cutover

```bash
npx jskit list-navigation --details
npx jskit doctor
npm run verify
npx jskit app verify-ui
```

Then exercise this matrix in a real browser:

1. List → peer detail → peer detail.
2. Shell Back and browser Back in separate runs.
3. Browser Forward to the existing destination entry.
4. Edit/new machinery, Cancel, save, and unsaved-change confirmation.
5. Reload on a destination and on machinery.
6. Direct link, bookmark, and new-tab entry.
7. Storage denied and scope/principal change.
8. Compact bottom bar, medium rail, and expanded drawer.

The migration is complete only when URLs are clean, the shell owns the sole Back affordance, browser and shell chronology agree, registered list state restores, and Doctor reports no parallel navigation system.

## Quick mapping

| Remove | Replace with |
| --- | --- |
| Nested return query | `destination` entries and `preserve` machinery |
| Page Back button | `ShellLeadingNavigation` |
| `history.length` check | `canPop` / `canGoUp` from `useJskitNavigation()` |
| Button-only record navigation | `JskitDestinationLink` |
| Fixed-delay scroll restore | Contributor readiness plus stable anchor |
| Form-specific Back confirmation | Shared navigation blocker and Vuetify alert dialog |
| Separate phone/tablet/desktop menu lists | One semantic placement list rendered adaptively |
