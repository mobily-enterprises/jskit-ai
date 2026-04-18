# A more interesting shell

In the first chapter, the app was intentionally plain. That was useful because it let us see the smallest possible JSKIT scaffold without too many moving parts. In this chapter, we install `shell-web`, which is the package that turns that bare starting point into a real shell: a layout, navigation outlets, a first settings area, and a proper app-level error host.

This still is not authentication, not database work, and not multi-surface routing. The app remains small. But it starts to look and behave like something you could actually grow.

## Recap from previous chapters

To get back to the same starting point as the end of the previous chapter, run:

```bash
npx @jskit-ai/create-app exampleapp --tenancy-mode none
cd exampleapp
npm install
```

If you are already continuing from the previous chapter, you are already in the right place and can skip that setup.

## Installing `shell-web`

From inside `exampleapp`, run:

```bash
npx jskit add package shell-web
npm install
```


`jskit add` rewrites part of the scaffold and records the installed runtime package in `.jskit/lock.json`. The following `npm install` is what actually downloads the new package and its supporting dependencies.

To see the result, run:

```bash
npm run dev
npm run server
```

This time you really want both processes running. The new home page fetches `/api/health`, so the browser-facing dev server on port `5173` expects the backend on port `3000` to be alive as well.

<DocsTerminalTip label="Important" title="Install It Early">
`shell-web` is not just adding new files. It also **claims and replaces part of the original scaffold** so the app can switch from the plain starter layout to the real shell layout.

That replacement is intentionally strict: `shell-web` only takes over scaffold files if they are still **exactly** the same as the files that `create-app` originally wrote. If you have already edited those starter files, `shell-web` refuses to claim them instead of overwriting your work.

That is why the intended flow is:

1. scaffold the app
2. install `shell-web`
3. start personalizing the shell

If you build directly on top of the plain scaffold first and only try to add `shell-web` later, the install may fail because those app-owned files no longer match the untouched scaffold baseline.
</DocsTerminalTip>

Open `http://localhost:5173/` in the browser. The app still lands in the `home` surface, but that surface is no longer just a card in the middle of the page. It is wrapped in a real shell with an app bar, a navigation drawer, and a settings route at `/home/settings`.

<figure class="docs-browser-shot">
  <div class="docs-browser-shot__bar">
    <div class="docs-browser-shot__dots" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>
    <div class="docs-browser-shot__address">http://localhost:5173/</div>
  </div>
  <img
    src="/images/guide/a-more-interesting-shell/a-more-interesting-shell-home.png"
    alt="Example app after installing shell-web, showing the shell layout and starter home page"
  />
</figure>

Two important things have changed compared with the older starter shell.

- Navigation now lives in the drawer itself. `Home` and `Settings` are real shell menu entries from the start.
- `Settings` is already a real nested section. Opening `/home/settings` redirects to `/home/settings/general`, and the left-side menu already contains a starter `General` entry.

Open `http://localhost:5173/home/settings` in the browser to see that nested settings shell immediately:

<figure class="docs-browser-shot">
  <div class="docs-browser-shot__bar">
    <div class="docs-browser-shot__dots" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>
    <div class="docs-browser-shot__address">http://localhost:5173/home/settings/general</div>
  </div>
  <img
    src="/images/guide/a-more-interesting-shell/a-more-interesting-shell-settings-general.png"
    alt="Example app home settings page after installing shell-web, showing the seeded General child page and nested settings menu"
  />
</figure>

## Module features

The most important new idea in `shell-web` is that the app now has _specific, named places_ where UI can be inserted later. JSKIT calls those places _placements_. In practice, this means later packages or generators do not have to rewrite the whole shell every time they want to add a menu entry, a widget, or a settings section.

Start by asking JSKIT what placement targets already exist:

```bash
npx jskit list-placements
```

In a fresh `shell-web` app, the result looks like this:

```text
Available placements:
- home-settings:primary-menu [src/pages/home/settings.vue]
- shell-layout:primary-menu (default) [src/components/ShellLayout.vue]
- shell-layout:secondary-menu [src/components/ShellLayout.vue]
- shell-layout:top-left [src/components/ShellLayout.vue]
- shell-layout:top-right [src/components/ShellLayout.vue]
```

This command lists placement targets, not the content inside them. That is why the output is about target names and source files. Later, when you place things into the shell, this list stays the same unless you add or remove a `ShellOutlet` in source.

Those target names come from real `ShellOutlet` elements in the app. See `src/components/ShellLayout.vue`:

```html
...
<ShellOutlet target="shell-layout:top-left" />
...
<ShellOutlet target="shell-layout:top-right" />
...
<ShellOutlet
  target="shell-layout:primary-menu"
  default
  default-link-component-token="local.main.ui.surface-aware-menu-link-item"
/>
...
<ShellOutlet
  target="shell-layout:secondary-menu"
  default-link-component-token="local.main.ui.surface-aware-menu-link-item"
/>
```

And the settings page introduces its own nested outlet in `src/pages/home/settings.vue`:

```html
<ShellOutlet
  target="home-settings:primary-menu"
  default-link-component-token="local.main.ui.surface-aware-menu-link-item"
/>
```

That nested example matters. It shows that the shell is not the only place that can host placements. A page inside the shell can define its own insertion point too. That is how JSKIT can later build menus inside sections such as settings without rewriting the whole shell.

Just as importantly, `shell-web` already uses that placement system itself. The starter app is not only exposing placement targets; it is also seeding real placement entries into them. The drawer gets `Home` and `Settings`, and the nested settings menu gets `General`. That is why the shell already feels real before you generate anything of your own.

The shell also ships with a few app-owned component tokens that it can use as default link renderers. You can inspect those too:

```bash
npx jskit list-component-tokens --prefix local.main.
```

The starter result looks like this:

```text
Available placement component tokens:
Showing link-item tokens only (token must end with "link-item"). Tip: use --all for full token list.
- local.main.ui.menu-link-item [app:packages/main/src/client/providers/MainClientProvider.js]
- local.main.ui.surface-aware-menu-link-item [app:packages/main/src/client/providers/MainClientProvider.js, app:src/placement.js, package:@jskit-ai/shell-web:templates/src/placement.js]
- local.main.ui.tab-link-item [app:packages/main/src/client/providers/MainClientProvider.js]
```

So before we add anything of our own, the shell already knows about three local link-item tokens. They are app-owned components registered by the local package, and the shell uses them when an outlet needs to render links or tabs.

At this point the shell is already using placements itself. The next step is to add one of our own.


### Adding generic elements directly

To add a small UI element to the shell itself:

```bash
npx jskit generate ui-generator placed-element --name "Alerts Widget"
```

That command creates a Vue component under `src/components/` (in this case `src/components/AlertsWidgetElement.vue`), registers a new local token for it, and adds a placement entry targeting `shell-layout:top-right`. After running it, refresh the home page in the browser. The shell now has a real app-owned widget living inside one of its named placement targets.

<figure class="docs-browser-shot">
  <div class="docs-browser-shot__bar">
    <div class="docs-browser-shot__dots" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>
    <div class="docs-browser-shot__address">http://localhost:5173/home</div>
  </div>
  <img
    src="/images/guide/a-more-interesting-shell/a-more-interesting-shell-alerts-widget.png"
    alt="Example app home page after generating Alerts Widget, showing the widget rendered in the shell"
  />
</figure>

In this app, there is no need to pass `--surface`: since the app only has one enabled surface, JSKIT can infer it automatically.

### Adding a page with automatic menu placement

The settings host uses the same placement machinery, but the normal way to grow it is not by dropping a free-standing widget there. The more interesting case is adding a child page and letting JSKIT wire the menu entry for you.

The source path in the `list-placements` output helps you reason about where child pages belong. When you see:

```text
- home-settings:primary-menu [src/pages/home/settings.vue]
```

you know that the outlet lives in the settings host page. So if you want a child page to appear in that menu, you should create it under that part of the route tree instead of treating the menu like a generic widget area. For example, `src/pages/home/settings/profile/index.vue` belongs to that settings section, so JSKIT can wire its preferred menu entry into `home-settings:primary-menu` automatically.


Now use the settings host the way it is normally meant to be used: add a real child page under it.

```bash
npx jskit generate ui-generator page home/settings/profile/index.vue --name "Profile"
```

This is a more interesting example than the widget case. JSKIT creates the page file, notices that `src/pages/home/settings.vue` owns the `home-settings:primary-menu` outlet, and adds the preferred menu entry there automatically. You do not have to write that placement entry by hand.

Open `/home/settings/profile` in the browser. The settings shell now shows a second real child page and a second real menu entry created by the same page-generation command. `General` was already there from `shell-web`; `Profile` is the first additional settings page you add yourself. This is the important part of the chapter: the exact same placement system works both at the top shell level and inside a page-owned nested outlet.

<figure class="docs-browser-shot">
  <div class="docs-browser-shot__bar">
    <div class="docs-browser-shot__dots" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>
    <div class="docs-browser-shot__address">http://localhost:5173/home/settings/profile</div>
  </div>
  <img
    src="/images/guide/a-more-interesting-shell/a-more-interesting-shell-settings-profile.png"
    alt="Example app home settings page after generating the Profile child page, showing the automatic settings menu entry and child page content"
  />
</figure>

Now add a second sibling page:

```bash
npx jskit generate ui-generator page home/settings/notifications/index.vue --name "Notifications"
```

Open `/home/settings/notifications` in the browser. You now get a third settings menu entry without touching `settings.vue`, without writing a second menu component, and without hand-editing `src/placement.js`. JSKIT appends another placement entry targeting the same `home-settings:primary-menu` outlet, so the links simply stack in the menu for free.

The order is also easy to reason about:

- `General` comes first because `shell-web` seeds it with a lower order than generated child pages.
- `Profile` and `Notifications` both use the generator's default order, so between those two the menu keeps source order.

<figure class="docs-browser-shot">
  <div class="docs-browser-shot__bar">
    <div class="docs-browser-shot__dots" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>
    <div class="docs-browser-shot__address">http://localhost:5173/home/settings/notifications</div>
  </div>
  <img
    src="/images/guide/a-more-interesting-shell/a-more-interesting-shell-settings-stacked-links.png"
    alt="Example app home settings page after generating Profile and Notifications child pages, showing the stacked automatic settings menu entries"
  />
</figure>

<DocsTerminalTip label="Routing" title="Child Pages Under Layouts">
In JSKIT's file-based routing, a page file can act as a layout if it renders a `RouterView`.

- `src/pages/home/settings.vue` owns the settings shell and wraps its child routes.
- `src/pages/home/settings/index.vue` is now just a redirect, so `/home/settings` lands on `/home/settings/general`.
- `src/pages/home/settings/general/index.vue` is the first real child page created by the starter shell.
- `src/pages/home/settings/profile/index.vue` becomes `/home/settings/profile` and still renders inside the layout from `settings.vue`.

This is why the `home-settings:primary-menu` outlet from `list-placements` is such a useful clue: it tells you which page is acting as the host.

Even an `index.vue` page can have children. If you want an index page to stay visible while child routes render underneath it, put those children under an `index/` directory such as `src/pages/home/settings/profile/index/details.vue`.
</DocsTerminalTip>

<DocsTerminalTip label="Icons" title="Menu Metadata Is Not The Same As Vue Icon Props">
When you start customizing generated pages and menu links, icons are one of the first details you usually add.

There are two different paths to keep straight:

1. placement and menu metadata such as `src/placement.js`
2. direct Vuetify icon props inside normal `.vue` components

In placement metadata, raw `mdi-*` strings are acceptable because the shell menu runtime normalizes them before Vuetify renders the icon. A menu entry like this is fine:

```js
addPlacement({
  id: "home.settings.profile.link",
  target: "home-settings:primary-menu",
  componentToken: "local.main.ui.surface-aware-menu-link-item",
  props: {
    label: "Profile",
    to: "./profile",
    icon: "mdi-account-circle-outline"
  }
});
```

But do not copy that same string into a normal Vue component:

```vue
<v-list-item prepend-icon="mdi-account-circle-outline" />
```

JSKIT apps use Vuetify's SVG MDI renderer, so direct Vue icon props should use an `@mdi/js` path or a Vuetify alias instead:

```vue
<script setup>
import { mdiAccountCircleOutline } from "@mdi/js";
</script>

<v-list-item :prepend-icon="mdiAccountCircleOutline" />
```

So the practical rule is:

- editing `src/placement.js` or other shell menu metadata: `mdi-*` strings are fine
- editing a normal `.vue` file: use `@mdi/js` or a Vuetify alias such as `$close`

Later in the guide, `jskit doctor` will help catch the second mistake automatically.
</DocsTerminalTip>


### Component tokens

If you rerun the token listing now, you will see that only the widget command created a new app-owned component token:

```bash
npx jskit list-component-tokens --all --prefix local.main.
```

The output now includes:

```text
- local.main.ui.element.alerts-widget
- local.main.ui.menu-link-item
- local.main.ui.surface-aware-menu-link-item
- local.main.ui.tab-link-item
```

That difference is useful. `npx jskit generate ui-generator placed-element` creates a new component token. `page` reuses the existing default link-item token for the parent outlet and adds a placement entry for the new route.

So the shell story in this chapter is:

- `ShellOutlet` defines named places where UI can appear
- `jskit list-placements` shows those places
- `shell-web` already uses those places for the starter `Home`, `Settings`, and `General` entries
- `jskit generate ui-generator placed-element ...` creates app-owned UI and places it into one of them
- `jskit generate ui-generator page ...` can also discover a parent outlet and add the right menu entry automatically
- repeating that page command for the same host gives you a stacked menu, still without hand-editing the host page
- nested pages can host placements too, not just the top shell

That is the first real example of JSKIT behaving like an extension system rather than just a scaffold generator.

## What `shell-web` changes in the app

The most interesting files now look roughly like this:

```text
src/
  components/
    AlertsWidgetElement.vue
    ShellLayout.vue
    menus/
      MenuLinkItem.vue
      SurfaceAwareMenuLinkItem.vue
      TabLinkItem.vue
  error.js
  placement.js
  pages/
    home.vue
    home/
      index.vue
      settings.vue
      settings/
        index.vue
        general/
          index.vue
        profile/
          index.vue
        notifications/
          index.vue
```

This chapter is the first time the scaffold starts to feel layered instead of flat.

### `package.json` and `.jskit/lock.json`

The first file worth reopening is still `package.json`. After `shell-web`, the most important new dependency entries are:

```json
{
  "dependencies": {
    "@jskit-ai/shell-web": "0.x",
    "@tanstack/vue-query": "^5.90.5",
    "@mdi/js": "^7.4.47"
  }
}
```

The important part is not just that `@jskit-ai/shell-web` appears. The package also brings in Vue Query and icon data because the starter shell now includes a live health check and shell-specific UI elements.

It is also worth noticing what does **not** happen here. The `placed-element` and `page` commands from this chapter mutate app-owned files, but they do not add a permanent runtime dependency to `package.json`. They are tooling actions, not runtime package installs.

The lock file becomes more interesting too. In the first chapter, `.jskit/lock.json` only knew about `@local/main`. Now it also records `@jskit-ai/shell-web` and the exact files and text mutations that package introduced.

That is worth noticing because this is the first chapter where JSKIT is no longer just scaffolding a base app. It is now applying a runtime package that owns concrete changes in your app tree.

### The `home` surface gets a real wrapper

The surface itself did not change. `home` is still the same surface defined in `config/public.js`. What changed is the page tree inside it.

Before `shell-web`, `src/pages/home.vue` was only a tiny route owner with a `RouterView`. After installing `shell-web`, it becomes:

```vue
<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "home"
    }
  }
}
</route>

<script setup>
import ShellLayout from "@/components/ShellLayout.vue";
import { RouterView } from "vue-router";
</script>

<template>
  <ShellLayout title="" subtitle="">
    <RouterView />
  </ShellLayout>
</template>
```

That one change explains a lot. The `home` surface is no longer just a place where pages live. It is now a shell-wrapped surface. Every child page under `src/pages/home/` renders inside that app-owned `ShellLayout`.

### `src/placement.js` becomes the placement registry

After installing `shell-web`, the app gets a placement registry file:

```js
import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement };

export default function getPlacements() {
  return registry.build();
}
```

That file is the app-owned seam for placements. `shell-web` owns the runtime that can render placements, but the app owns the registry source that lists what should appear in those targets.

After the `shell-web` install plus the `placed-element` and `page` commands from this chapter, the bottom of the file now contains real placement entries:

```js
addPlacement({
  id: "shell-web.home.menu.home",
  target: "shell-layout:primary-menu",
  surfaces: ["*"],
  order: 50,
  componentToken: "local.main.ui.surface-aware-menu-link-item",
  props: {
    label: "Home",
    surface: "home",
    scopedSuffix: "/",
    unscopedSuffix: "/",
    exact: true
  }
});

addPlacement({
  id: "shell-web.home.menu.settings",
  target: "shell-layout:primary-menu",
  surfaces: ["home"],
  order: 100,
  componentToken: "local.main.ui.surface-aware-menu-link-item",
  props: {
    label: "Settings",
    surface: "home",
    scopedSuffix: "/settings",
    unscopedSuffix: "/settings"
  }
});

addPlacement({
  id: "shell-web.home.settings.general",
  target: "home-settings:primary-menu",
  surfaces: ["home"],
  order: 100,
  componentToken: "local.main.ui.surface-aware-menu-link-item",
  props: {
    label: "General",
    surface: "home",
    scopedSuffix: "/settings/general",
    unscopedSuffix: "/settings/general",
    to: "./general"
  }
});

addPlacement({
  id: "ui-generator.element.alerts-widget",
  target: "shell-layout:top-right",
  surfaces: ["home"],
  order: 155,
  componentToken: "local.main.ui.element.alerts-widget"
});

addPlacement({
  id: "ui-generator.page.home.settings.profile.link",
  target: "home-settings:primary-menu",
  surfaces: ["home"],
  order: 155,
  componentToken: "local.main.ui.surface-aware-menu-link-item",
  props: {
    label: "Profile",
    surface: "home",
    scopedSuffix: "/settings/profile",
    unscopedSuffix: "/settings/profile",
    to: "./profile"
  }
});

addPlacement({
  id: "ui-generator.page.home.settings.notifications.link",
  target: "home-settings:primary-menu",
  surfaces: ["home"],
  order: 155,
  componentToken: "local.main.ui.surface-aware-menu-link-item",
  props: {
    label: "Notifications",
    surface: "home",
    scopedSuffix: "/settings/notifications",
    unscopedSuffix: "/settings/notifications",
    to: "./notifications"
  }
});
```

That snippet shows the full placement contract clearly:

- the target says where the UI should go
- the component token says what should render that entry
- `props.to` tells the generated menu link which child route to open
- `props.icon`, when you add one, belongs to menu metadata rather than direct Vuetify icon rendering
- the surface list says where it is active
- lower `order` values come first
- when multiple entries target the same outlet with the same order, the shell keeps their source order

That is why the settings menu now shows `General` first, followed by `Profile` and `Notifications`: `General` is seeded by `shell-web` with a lower order, while the two generated pages share the same later order and keep their source order.

So the shell itself remains stable. What changes is the registry that feeds it.

### The local client provider publishes the app-owned components

The placement registry only points at tokens. Those tokens still need to resolve to real Vue components somewhere. That happens in the app-local client provider in `packages/main/src/client/providers/MainClientProvider.js`.

After the `shell-web` install and the `Alerts Widget` generator command, that file contains registrations like these:

```js
import AlertsWidgetElement from "/src/components/AlertsWidgetElement.vue";

registerMainClientComponent("local.main.ui.element.alerts-widget", () => AlertsWidgetElement);

registerMainClientComponent("local.main.ui.menu-link-item", () => MenuLinkItem);
registerMainClientComponent("local.main.ui.surface-aware-menu-link-item", () => SurfaceAwareMenuLinkItem);
registerMainClientComponent("local.main.ui.tab-link-item", () => TabLinkItem);
```

This is the same app-local provider seam from the previous chapter, but now you can see why it matters. The provider is what lets the placement runtime resolve app-owned components by token instead of hard-coding imports inside the shell runtime.

The `Profile` and `Notifications` pages did not need to add another provider registration because they reuse the existing `local.main.ui.surface-aware-menu-link-item` token for their menu entries.

So the flow is:

1. a placement entry names a component token
2. the local client provider publishes that token
3. the `ShellOutlet` resolves it at runtime

That is why the placement system feels dynamic even though the app still owns all of the concrete Vue files.

### `App.vue` and `error.js` now support shell-level errors

The top-level app root changes too. `src/App.vue` is no longer just:

```vue
<v-app>
  <RouterView />
</v-app>
```

It now also includes a shell error host:

```vue
<script setup>
import { RouterView } from "vue-router";
import ShellErrorHost from "@jskit-ai/shell-web/client/components/ShellErrorHost";
</script>

<template>
  <v-app>
    <RouterView />
    <ShellErrorHost />
  </v-app>
</template>
```

That host is backed by the new app-owned `src/error.js` file:

```js
import { createDefaultErrorPolicy } from "@jskit-ai/shell-web/client/error";

export default Object.freeze({
  defaultPresenterId: "material.snackbar",
  policy: createDefaultErrorPolicy(),
  presenters: []
});
```

The idea is the same as with placements: `shell-web` provides the runtime, but the app owns the configuration file that the runtime reads.

### The home page is no longer static

`src/pages/home/index.vue` is also more interesting now. It is no longer just a welcome card. It uses Vue Query to fetch `/api/health` and display the result in the UI.

That is why this chapter is the point where running both `npm run dev` and `npm run server` stops feeling optional. The page now expects the backend to be alive.

This matters because it is the first tiny example of the frontend and backend participating in the same shell. The request itself is simple, but the behavior is more realistic than the empty starter card from the previous chapter.

### The first client stores appear

This is also the first chapter where an installed package starts exposing app-facing Pinia stores. `shell-web` exports these two:

```js
import {
  useShellLayoutStore,
  useShellErrorPresentationStore
} from "@jskit-ai/shell-web/client";
```

`useShellLayoutStore()` owns the shell drawer state:

- whether the drawer is open right now
- whether the drawer should open by default on load

`useShellErrorPresentationStore()` exposes the current banner, snackbar, and dialog presentation state behind `ShellErrorHost`.

The simplest direct store usage looks like this:

```vue
<script setup>
import { computed } from "vue";
import { useShellLayoutStore } from "@jskit-ai/shell-web/client";

const shellLayout = useShellLayoutStore();

const drawerDefaultOpenModel = computed({
  get() {
    return shellLayout.drawerDefaultOpen;
  },
  set(value) {
    shellLayout.setDrawerDefaultOpen(Boolean(value));
  }
});
</script>
```

That is the raw shared store behind the starter `General` settings page. It is just normal Pinia state and actions: read `drawerDefaultOpen`, write it back through `setDrawerDefaultOpen(...)`, and the shell reacts.

The same store also exposes the live drawer state through `drawerOpen`, plus `setDrawerOpen(...)` and `toggleDrawer()` for components that need to control the drawer directly instead of only changing its default preference.

You do not need either store very often in this chapter, because `shell-web` already mounts the shell and error host for you. The starter `General` settings page uses the higher-level `useShellLayoutState()` helper instead of talking to `useShellLayoutStore()` directly, because that helper combines the store-backed drawer state with the current route and surface context that `ShellLayout` also needs.

That distinction is worth noticing early:

- runtime services still do the operational work
- Pinia stores are now the normal Vue-facing shared-state surface

### The first settings route appears

`shell-web` also creates a settings shell for the `home` surface:

```text
src/pages/home/settings.vue
src/pages/home/settings/index.vue
src/pages/home/settings/general/index.vue
```

The important host file is still `src/pages/home/settings.vue`:

```vue
<v-list nav density="comfortable" rounded="lg" border>
  <ShellOutlet
    target="home-settings:primary-menu"
    default-link-component-token="local.main.ui.surface-aware-menu-link-item"
  />
</v-list>

<RouterView />
```

This file matters for the same reason as `ShellLayout.vue`: it creates another named extension point instead of hard-coding a finished settings UI. The difference is that this one lives inside a page, not at the top shell level.

The starter shell now uses a real child-page structure right away:

- `src/pages/home/settings/index.vue` is only a redirect into the first child page
- `src/pages/home/settings/general/index.vue` is the first real settings page
- `src/placement.js` already seeds a `General` link into `home-settings:primary-menu`

That is what makes the page-generation examples in this chapter important. They are not inventing a new pattern. They are extending the exact same host-and-child-page structure that `shell-web` already uses for its own starter `General` page.

### What did not change

It is also worth being explicit about what `shell-web` does **not** do yet:

- it does not add authentication
- it does not add a database
- it does not add new surfaces
- it does not change the local server provider model

The app is still structurally simple. `shell-web` just makes that simple app behave like a shell instead of a loose page.

## Summary

After this chapter, the app is still small, but it is no longer flat. `shell-web` adds an app-owned shell layout, a placement registry, a shell error host, menu-link tokens in the local client provider, real drawer navigation, and the first nested settings section under `home`.

More importantly, this chapter is where placements stop being theory. The shell already uses them for `Home`, `Settings`, and the starter `General` settings page. Then you inspect the available targets, place real UI into the outer shell, and add more child settings pages that automatically land in the nested settings menu. That is the first real example of JSKIT working as an extension system rather than just a scaffold generator.
