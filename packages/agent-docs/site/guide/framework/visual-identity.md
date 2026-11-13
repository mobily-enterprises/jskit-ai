---
title: Visual identity
description: Where each piece of an identity pass lives in a JSKIT app, the Material 3 pieces it uses, and the checks that prove it.
---

# Visual identity

An identity pass gives an app a look of its own. Genesis's identity pass skill
(`genesis-identity-pass`) holds the method: study the app's kinds of content,
choose a style option, then build the theme, the artwork, the logo, the loading
screen and sign-in, and prove them. This page says where each piece lives in a
JSKIT app and which checks prove it. Read the [Material 3 rules](/guide/framework/material-3)
first: the identity works inside them, never against them, and navigation stays
must-fix.

## Theme: one seed

- `src/theme/index.js` is the app's only theme file: `{ seed, colors, icons,
  typography }`, passed to `createMaterialVuetifyOptions()` from
  `@jskit-ai/material-web/client` ([Foundation](/guide/framework/material-3#foundation)).
  The seed generates the light and dark schemes; change it and both follow.
- A colour role per kind of content goes in `colors` by camelCase name.
  `colors: { soups: "#B5562B", breads: "#8A6A2F" }` gives `soups`, `on-soups`,
  `soups-container` and `on-soups-container` (and the same for `breads`),
  harmonized toward the seed in both schemes; `{ value: "#F5C518", blend:
  false }` keeps a colour's own hue. Use them by name:
  `<v-chip color="soups-container">`.
- Interface code uses roles only. `jskit check m3` fails a hex colour outside
  `src/theme/` (`m3/raw-hex`).

## Content colours: `src/theme/palettes.js`

Every colour that is content rather than interface lives here: named exports
of frozen plain hex values, each with a comment saying where it is used, as the
Material 3 page's [exceptions](/guide/framework/material-3#exceptions) describe.

```js
// src/theme/palettes.js

// Cover art, per kind of content: the gradient's two stops, the motif's accent and its light colour
// (src/components/art/CoverArt.vue). `brand` draws items without a kind.
export const coverPalettes = Object.freeze({
  brand: Object.freeze({ from: "#1F3A5F", to: "#3E7C8C", accent: "#F2B544", light: "#F6EFE3" }),
  soups: Object.freeze({ from: "#7A2E1C", to: "#C8642F", accent: "#F4C95D", light: "#FBEFE1" }),
  breads: Object.freeze({ from: "#5B4320", to: "#A7803E", accent: "#E8D3A2", light: "#FFF8EA" })
});

// The logo tile, favicon.svg and the app icons (src/components/BrandLogo.vue).
export const logoColours = Object.freeze({ from: "#1F3A5F", to: "#3E7C8C", mark: "#F2B544", markShade: "#E07A3F" });

// The sign-in brand pane's glow and ink (src/components/AppBrand.vue).
export const signInPane = Object.freeze({ glow: "#3E7C8C", ink: "#0E1A26" });
```

Components read them through bindings (`:fill`, `:stop-color`, or `v-bind()`
in a scoped `<style>`), never as literals.

## Cover art: `src/components/art/CoverArt.vue`

- Props `kind` and `seed` (strings) and `height` (a number), declared typed as
  the [client features](/guide/framework/client-features) guide asks.
- The root is `<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"
  aria-hidden="true" width="100%" :height="height">`: one 2:1 drawing serves a
  card, a strip and a thumbnail.
- The motifs are data in `src/components/art/motifs.js`, one list of
  `{ tag, ...attributes }` shapes per kind, drawn with `<component
  :is="shape.tag" v-bind="shape.attributes" />`. A native SVG tag (`circle`,
  `path`, `rect`) named as a string is fine; `ui/vuetify-by-name` concerns
  Vuetify components only.
- The seeded generator from the Genesis skill lives once, in the component's
  module, seeded with `` `${kind}:${seed}` ``; the item's id or slug is the seed.
- A gradient's `id` carries the kind and the seed (`cover-soups-42`), so two
  covers on one page never share one.
- A Vitest component test renders one kind and seed twice and gets the same
  markup, and two seeds of one kind and gets different markup.

## Where it appears

- **Cards:** a flat `v-card` whose first child is `<CoverArt :height="130">`;
  the card's 12dp corners clip it, so the art has no radius of its own. Then
  the title in `text-title-large` (a stretched link that opens the record),
  "By …" in `text-body-medium text-on-surface-variant`, a short description,
  `variant="tonal"` chips (the kind with its icon, the level), and one
  `text-body-small` meta line with small icons
  ([Lists, records and forms](/guide/framework/material-3#lists-records-and-forms)).
- **Hero card and profile header:** a `CoverArt` strip, with the `v-avatar`
  overlapping its lower edge.
- **Empty states:** `src/components/art/EmptyArt.vue`: a 224×112 `CoverArt`
  in a wrapper with 28dp corners, the state's icon in a 64dp `v-avatar
  color="surface"` with `<v-icon color="primary">` in its middle and an
  `elevation` class for the soft shadow (a hand-made `box-shadow` fails
  `m3/raw-hex`), then a `text-title-large` line, a `text-body-medium` hint and
  one `variant="tonal"` button.
- **Logo:** `src/components/BrandLogo.vue` draws the 512×512 tile (`rx="112"`)
  inline from `logoColours`. The app's `favicon.svg` (beside `index.html` in
  the foundation) is the same drawing with its colours written in; its
  comment names `palettes.js` as their source. An app with
  `manifest.webmanifest` lists its icons from the same drawing, and an app with
  a mobile target renders its 1024×1024 PNG `Icon` from it on an opaque
  background.
- **Loading screen:** `index.html`'s `#startup-shell`, which shows before any
  JavaScript runs. Put the logo inline, the name as `<title>` spells it, and
  the tagline in it; keep its `role="status"` line, its `<noscript>` and its
  Reload link. Its colours are literal because it runs before the theme: take
  them from `palettes.js` and the seed's schemes, and say so in a comment. Its
  rotation runs only inside `@media (prefers-reduced-motion: no-preference)`.
- **Sign-in:** `src/components/AppBrand.vue`, from the `auth/auth-surface`
  pattern, fills the auth views' `brand` slot. Wide (`compact` false), it is the brand
  pane: a radial glow from `signInPane.glow` into `signInPane.ink`, the logo,
  the name, the tagline and three short lines on what the app does, a large
  faint accent ring and a few soft light bubbles. On phones (`compact`), the
  logo and the name over a `CoverArt` strip of kind `brand`. It holds no
  heading: each auth screen's `h1` is its own.

## The Material 3 pieces it uses

- **Pages open onto content.** The shell's top app bar carries the page's
  title and actions ([The top app bar carries the page](/guide/framework/material-3#the-top-app-bar-carries-the-page)):
  no welcome heading or title block.
- **"New"** is `ShellPrimaryAction`: an extended FAB on compact and medium
  widths, a filled bar button on expanded ones.
- **Bottom navigation** on phones is the shell's navigation bar, drawn from the
  surface's destinations: keep five or fewer. A surface with fewer than two
  destinations draws no navigation at all, so there is never an empty drawer.
- **Loading** uses Material skeletons with the content's geometry, never a
  spinner ([Components, state, and feedback](/guide/framework/material-3#components-state-and-feedback)).
- **Changing numbers** use `font-variant-numeric: tabular-nums`.
- **New list items** pop in through a Vue `<TransitionGroup>` with a scoped
  keyframe (from `scale(0.6)` and `opacity: 0` over 600 ms, easing
  `var(--md-sys-motion-easing-emphasized-decelerate)`). `material.css` finishes
  every animation at once under `prefers-reduced-motion: reduce`, so the app
  adds no media query of its own.
- **Button and chip overlays** take their shape's corners from `material.css`
  (`border-radius: inherit` on the overlay, underlay and ripple). If one still
  spills past its shape, report it at `@jskit-ai/material-web`; never add app
  CSS for it.

## Prove it

- `npx jskit check m3` reports nothing and `npx jskit check` passes.
- Take the screenshots with a temporary Playwright spec as the
  [UI pass](/guide/framework/ui-pass) shows: the main list, a record, an empty
  state, `/auth/login` at 390 and 1280, and the profile, at 390 and 1280 wide,
  in light and dark. Look at every one.
- Contrast: compute the ratio of each writing colour over each identity colour,
  from the `palettes.js` values and the generated roles
  (`useTheme().current.value.colors`) in both schemes.
- Layout shift: in the same spec, collect `layout-shift` entries with a
  `PerformanceObserver` while a list loads; their sum stays near zero.
- Run the Vitest test of `CoverArt.vue` and the affected screens' tests.
