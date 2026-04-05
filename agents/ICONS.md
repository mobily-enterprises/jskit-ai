# Icon Rules For AI Agents

This repo uses Vuetify icons in a way that is easy to get wrong.

Read this before changing icon code.

## Core Model

Vuetify has three separate concepts:

1. Renderer format
2. Icon set
3. Icon value

Do not confuse them.

### 1. Renderer format

These are Vuetify renderers, not icon sets:

- `VComponentIcon`
- `VSvgIcon`
- `VLigatureIcon`
- `VClassIcon`

Think of them as "how Vuetify draws the icon".

Examples:

- `VSvgIcon` expects SVG path data
- `VClassIcon` expects CSS class names such as `mdi-cog-outline`

### 2. Icon set

An icon set picks one renderer.

Examples:

- class MDI set -> class renderer
- svg MDI set -> svg renderer

A set should be treated as one format at a time.

### 3. Icon value

This is the actual value passed to Vuetify.

Examples:

- `"mdi-cog-outline"`
- `mdiCogOutline` from `@mdi/js`
- `"$close"`

Whether a value is valid depends on the configured set.

## What This Repo Uses

Generated apps in this repo use the SVG MDI setup, not the class-based one.

See:

- `tooling/create-app/templates/base-shell/src/main.js`
- app `src/main.js` files generated from that template

Current pattern:

```js
import { aliases as mdiAliases, mdi } from "vuetify/iconsets/mdi-svg";

const vuetify = createVuetify({
  icons: {
    defaultSet: "mdi",
    aliases: mdiAliases,
    sets: { mdi }
  }
});
```

Important:

- the set name is still `"mdi"`
- but it is the SVG MDI set from `vuetify/iconsets/mdi-svg`
- therefore icons in direct Vue usage must be SVG-compatible

## What Vuetify Accepts In This Setup

### Valid in direct Vue templates

Use one of these:

1. `@mdi/js` path constants

```vue
<script setup>
import { mdiPaw } from "@mdi/js";
</script>

<v-icon :icon="mdiPaw" />
```

2. Vuetify aliases

```vue
<v-icon icon="$close" />
```

Alias values in the MDI SVG set resolve to `svg:...` values internally.

### Invalid in direct Vue templates

Do not do this:

```vue
<v-icon icon="mdi-paw" />
<v-list-item prepend-icon="mdi-cog-outline" />
<v-icon :icon="'mdi-paw'" />
```

Why this is wrong:

- those are class-style MDI names
- our apps are configured for SVG MDI rendering
- Vuetify ends up treating the string as SVG path data

That leads to errors like:

```txt
Error: <path> attribute d: Expected number, "mdi-paw"
```

## The One Important Exception

There is a framework compatibility layer for metadata-driven menu icons.

See:

- `packages/users-web/src/client/lib/menuIcons.js`
- `packages/users-web/src/client/components/UsersShellMenuLinkItem.vue`

This path is special:

1. placement metadata may contain `icon: "mdi-cog-outline"`
2. `resolveMenuLinkIcon(...)` converts that string into the real `@mdi/js` SVG path
3. Vuetify receives the normalized value

So this metadata is allowed:

```js
props: {
  icon: "mdi-cog-outline"
}
```

But only because it is normalized before rendering.

Do not copy that pattern into ordinary Vue components.

## Rules For Changes

If you are editing a `.vue` file in an app or template:

1. Never introduce raw `mdi-*` strings into `icon`, `prepend-icon`, or `append-icon`.
2. Prefer direct `@mdi/js` imports for explicit icons.
3. Use a Vuetify alias only if there is already a good alias for the icon.

Good:

```vue
<script setup>
import { mdiShieldCheckOutline } from "@mdi/js";
</script>

<v-icon :icon="mdiShieldCheckOutline" />
```

Bad:

```vue
<v-icon icon="mdi-shield-check-outline" />
```

## What To Do In Different Contexts

### Direct Vue component/page

Use `@mdi/js`.

```vue
<script setup>
import { mdiFoodApple } from "@mdi/js";
</script>

<v-icon :icon="mdiFoodApple" />
```

### Framework placement/menu metadata

If the icon flows through `resolveMenuLinkIcon(...)`, `mdi-*` strings are acceptable.

If it does not, do not assume they are safe.

### Generator/template code

Emit direct `@mdi/js` icon imports in generated Vue files.

Do not generate raw `mdi-*` strings into Vuetify icon props.

## Enforcement

This repo now enforces the rule through `jskit doctor`.

See:

- `tooling/jskit-cli/src/server/commandHandlers/health.js`

The doctor check:

- detects apps using `vuetify/iconsets/mdi-svg`
- scans `.vue` files under `src/` and `packages/`
- fails on direct raw `mdi-*` usage in Vuetify icon props

It intentionally does not flag metadata files like `placement.js`, because those may be normalized by framework code.

## AI Checklist

Before changing icons, ask:

1. Is this a direct Vue icon prop?
2. If yes, am I using `@mdi/js` or a Vuetify alias?
3. Is this metadata that goes through `resolveMenuLinkIcon(...)`?
4. Am I accidentally mixing class-style MDI names with SVG MDI rendering?

If unsure, use `@mdi/js` in direct Vue code. That is the safest default in this repo.
