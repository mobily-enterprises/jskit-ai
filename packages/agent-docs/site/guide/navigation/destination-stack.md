# Destination-stack navigation

JSKIT navigation has one rule that makes the system easier to reason about: browser history is the chronological transport, and JSKIT adds validated metadata needed to restore meaningful destinations. There is no second app-owned array pretending to be browser history.

This is a version-0 contract. When navigation is enabled, every committed route must declare `meta.jskit.navigation`. JSKIT does not guess from URL depth, route names, or older `returnTo` conventions.

For an existing application, start with the [migration checklist](/guide/navigation/migrate-existing-apps).

## The three route behaviors

Use `destination` for a meaningful URL-addressable screen in the user's work trail. Lists, dashboards, calendars, record views, and peer record views can all be destinations.

Use `preserve` for subordinate machinery such as edit, create, confirmation, picker, or short wizard routes. A preserving browser entry points at the important destination that owns it; it does not create another destination.

Use `boundary` for a committed internal route that deliberately owns no restorable destination, such as a visible auth callback, sign-out transition, or sensitive invitation flow.

```vue
<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "admin",
      "navigationRole": "detail",
      "navigation": {
        "behavior": "destination",
        "destinationKey": "inventory.products.view",
        "labelKey": "navigation.product",
        "fallback": { "name": "admin-products" },
        "scope": ["principal", "surface", "workspace"],
        "persistence": {
          "mode": "snapshot",
          "queryAllowlist": ["q", "status", "sort"]
        }
      }
    }
  }
}
</route>
```

A preserving edit route is explicit too:

```ts
definePage({
  meta: {
    jskit: {
      navigation: {
        behavior: "preserve",
        machineryKey: "inventory.products.edit",
        scope: ["principal", "surface", "workspace"],
        persistence: { mode: "url-only" }
      }
    }
  }
});
```

`destinationKey` and `machineryKey` are stable, nonlocalized route-family identifiers, not record ids. Stack behavior is independent of `--navigation-role`: one controls chronology, while the other controls where a product link is exposed. Generators record that second axis as the sibling `meta.jskit.navigationRole` field so `list-navigation` can show both decisions without conflating them.

## Enabling the runtime

Keep the exact `RouterHistory` supplied to Vue Router and pass the returned runtime into client bootstrap:

```ts
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
  bootClientModules,
  surfaceRuntime,
  surfaceMode,
  fallbackRoute
});
```

The default scope resolver reads `meta.jskit.surface`, workspace params such as `workspaceSlug`, and tenant params such as `tenantSlug`. `auth-web` supplies the authenticated principal before navigation initializes and rotates the task when that principal changes. A custom identity provider must supply `scopeResolver` in the navigation options or call `navigation.setScope({ principal })` with an opaque, non-secret fingerprint whenever identity changes.

The runtime is registered once as `jskit.client.navigation`, provided through `JSKIT_NAVIGATION_RUNTIME_KEY`, and returned in the frozen bootstrap result. Installing another runtime for the same router is an error; reinstalling with the same router and history returns the existing instance.

## Navigating

Use the public composable for programmatic navigation:

```ts
const navigation = useJskitNavigation();

await navigation.push({
  name: "admin-product",
  params: { productId }
});

await navigation.preserve({
  name: "admin-product-edit",
  params: { productId }
});
```

`push()` creates an important destination when the final committed route is `destination`. `preserve()` adds machinery and keeps the owning destination identity. `replace()` changes the current native entry without adding depth. `pop()` performs one validated in-app native Back step. `goUp()` closes a transient layer first, otherwise performs that same pop, and finally may use a declared synthetic fallback.

For record navigation, render a real link:

```vue
<JskitDestinationLink
  :to="{ name: 'admin-product', params: { productId: product.id } }"
  :aria-label="`View ${product.name}`"
>
  {{ product.name }}
</JskitDestinationLink>
```

`JskitDestinationLink` renders an `<a href>`. It intercepts only an ordinary unmodified primary click. Cmd/Ctrl-click, Shift-click, middle-click, `_blank`, downloads, context menus, copying, and opening a new tab keep normal browser semantics.

## Back, Up, menu, and fallback

Browser or system Back reverses chronology and may eventually leave the app. The shell's leading arrow is app-scoped Back: it pops the same immediate stamped browser entry but never exits the app. Menu opens primary navigation and never changes the stack.

On a direct destination with no organic predecessor, `fallback` is the only synthetic Up source. Activating it uses one `router.replace()` and makes the fallback the new initial destination. JSKIT never trims path segments or reads `history.length` to invent a parent.

When neither a predecessor nor fallback exists, Up is unavailable. The shell shows menu on a toggleable compact layout, or no leading control when navigation is already permanently visible.

## Persistence and security

The runtime merges a small versioned envelope under `history.state.__jskit.navigation`. It reads fresh router history state before every merge and preserves all Vue Router and third-party keys.

Larger snapshots use bounded same-tab `sessionStorage`, with an in-memory fallback. Defaults are 50 entries, 64 KiB per snapshot, 1 MiB per task, and a 12-hour TTL.

- `none` stores no JSKIT query, hash, contributor snapshot, or sensitive full path beyond the minimal safe envelope.
- `url-only` keeps native URL behavior but writes no contributor snapshot.
- `snapshot` permits registered contributor state and only duplicates allowlisted or sanitized query data into JSKIT storage.

The current browser URL remains canonical regardless of mode. Never register passwords, tokens, uncontrolled drafts, payment data, free-form sensitive notes, DOM nodes, whole stores, or API responses. Stored state is not authorization; guards and declared principal/surface/workspace/tenant scopes are checked again on restoration.

Authentication's short-lived approved `returnTo` parameter is separate from destination-stack navigation. It may carry a validated post-login target, but normal in-app pages must not build nested return-query chains.

## Inspecting the contract

```bash
npx jskit list-navigation --details
npx jskit list-navigation --json
npx jskit doctor
```

Doctor reports missing behavior, missing or duplicate stable keys, parallel return-query helpers, page-owned Back controls, unsafe history manipulation, duplicate runtime installation, and shell/adaptive-navigation omissions. Fix the route or shared integration; do not add a local bypass.
