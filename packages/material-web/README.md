# Material 3 for JSKIT apps

`@jskit-ai/material-web` makes a JSKIT Vuetify app exact Material 3 out of the
box, in light and dark: no app CSS, overrides or patches. It has no client
provider and registers nothing; the app's `src/main.js` passes its options to
`createVuetify()`.

```js
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { theme } from "./theme/index.js";

const vuetify = createVuetify(createMaterialVuetifyOptions(theme));
```

The app's only theme file is `src/theme/index.js`:

```js
export const theme = {
  seed: "#6750A4",
  colors: {},
  icons: {},
  typography: {}
};
```

## What it sets

- **Colour.** One seed colour generates the light and dark schemes with
  Material Color Utilities (`SchemeTonalSpot`, the Material 3 default). Every
  Material 3 role is a Vuetify theme colour in kebab-case (`primary`,
  `on-primary-container`, `surface-container-high`, `outline-variant`, ...).
  `success`, `warning` and `info` are custom colours harmonized to the seed
  (`customColor` with `blend`), each with `on-`, `-container` and
  `on-…-container` roles. An app's own colours go in `theme.colors` by
  camelCase name and become custom colours the same way: `partner: "#0A7D3E"`
  gives `partner`, `on-partner`, `partner-container` and
  `on-partner-container`, harmonized to the seed, in both schemes;
  `{ value: "#F5C518", blend: false }` keeps the colour's own hue (Material
  Theme Builder's Blend switched off); a name that would replace a scheme role
  is refused. `defaultTheme` is `"system"`, so the app follows the
  device's light or dark setting. Theme variables carry the Material 3 state
  layers (hover 8%, focus 10%, pressed 10%, dragged 16%) and `border-color` and
  `shadow-color` as channel strings (`outline-variant` and `shadow`). There is no
  hand-picked colour and no generator command: change the seed and both schemes
  follow.
- **Icons.** Every Vuetify alias and JSKIT's own aliases are Material Symbols
  Rounded glyphs (outlined, Material Symbols' default; `$<name>Filled` for the
  active navigation item). JSKIT names are the symbol in camelCase: `$arrowBack`,
  `$add`, `$edit`, `$delete` (the trash can), `$search`, `$moreVert`,
  `$filterList`, `$home`, `$settings`, `$person`, ... The full list is
  `@jskit-ai/material-web/client/symbols`. An app adds its own in
  `theme.icons` as `{ name: "<24x24 path data>" }`, copied from the Material
  Symbols Rounded glyph (the `material-symbols:<name>-rounded` path in
  `@iconify-json/material-symbols`); `$name` then works everywhere.
- **Type.** Material 3's two typefaces, Roboto Flex (variable weight) unless
  the app names its own in `theme.typography`: `brand` for display, headline
  and title-large, `plain` for title-medium and -small, body and label. Each is
  a CSS font-family value, such as `'"Fraunces", serif'`; the app loads the
  font itself. The Material 3 type scale is Vuetify's `text-display-*`,
  `text-headline-*`, `text-title-*`, `text-body-*` and `text-label-*` classes,
  which read them as `--v-font-heading` and `--v-font-body`.
- **Components.** The md3 blueprint plus JSKIT's defaults: full-shape filled
  buttons (with `to`, active only on exactly their route), cards that rest
  flat on `surface-container-low` (`variant="elevated"` for level 1), flat expansion panels, outlined fields, 8dp chips that close with
  `$close`, the inverse-surface snackbar, the Material switch and the 16dp
  `primary-container` FAB; `v-btn-toggle` as a segmented button and
  `v-chip-group` as filter chips, selected in `secondary-container`.
- **`material.css`.** What props cannot set: 40dp buttons and 40dp icon
  buttons (none under 32dp, whatever its density), a 48dp touch target on
  every button size (small and x-small keep their look, and their state
  layers keep their corners) that stops at a neighbouring button, disabled container
  buttons in on-surface at 12% and 38%, a pagination's current page in the
  activated layer, placeholders, text field labels and supporting text and list
  item subtitles in on-surface-variant, one-line labels that
  end in an ellipsis, 12dp card corners, 28dp dialogs on
  `surface-container-high` at level 3 and bottom sheets with a square card on
  `surface-container-low`, square full-screen dialogs on `surface`, a 48dp touch target on clickable chips,
  inverse-surface tooltips, 40dp outlined segmented buttons and outlined
  filter chips that lead with a check when selected (chips with
  `aria-pressed` too), fixed tabs that share the width or else scroll, dialog
  actions 24dp from the edges, a menu's own list as its container
  (`surface-container` at level 2, in the menu's 4dp corners) while a list in a
  rich menu panel (a card or sheet in the menu) stays plain, a
  `v-bottom-navigation` as Material 3's navigation bar (each destination's 24dp
  icon in a 64x32 indicator, in `secondary-container` when active and holding
  the state layer, over a label-medium label), emphasized easing and reduced
  motion. It adds a `text-on-*` class for every `on-*` role of the
  scheme, which Vuetify names only `.on-<role>`, so `color="on-surface-variant"`
  and `class="text-on-surface-variant"` work; an app colour's `on-*` roles keep
  only Vuetify's `.on-<name>` class. Its
  component rules sit in Vuetify's `vuetify-overrides` cascade layer, so an
  app's own props and utility classes still win; only a disabled button's
  colours and a full-screen dialog's surface are unlayered, over the colour
  class a `color` prop gives. Nothing uses
  `!important` or Sass.

## Upstream workarounds

Each one comes off when the upstream fix ships; its test says when.

- **Vuetify 4.2.1 to 4.3.2 (measured): `VMenu` defaults and a `v-select`
  typeahead.** With any `VMenu` entry in the app's defaults, a sub-component
  default such as `VMenu: { VSheet: {} }` or even a prop default such as
  `VMenu: { scrim: false }`, a re-render of an ancestor of a `v-select` makes
  VMenu's `root` defaults provider build a new merged object; the menu's
  `VVirtualScroll` then resets its item height to 0 and `scrollToIndex`
  silently gives up. Letters typed during or after the menu's opening change
  the selection, but the match further down ("o" then "s" for Osaka, the last
  AWS region) is never scrolled to or focused. JSKIT sets no `VMenu` defaults:
  `material.css` draws a menu's own list as its container instead. Upstream
  issue:
  [vuetifyjs/vuetify#23366](https://github.com/vuetifyjs/vuetify/issues/23366).
  connectors-web's browser test "Vuetify still loses a select's typeahead
  match under a VMenu sub-component default when a panel around it re-renders"
  fails once a Vuetify release past 4.3.2 fixes it; then delete that test, and
  the menu list may go back to `VMenu` defaults. An app that adds its own
  `VMenu` defaults brings the bug back, except in connectors-web's
  configuration form, whose fields take the app's root defaults instead of
  each expansion panel's; an app's own panels can wrap their fields in
  `<v-defaults-provider root>` the same way. `VDialog`, Vuetify's other `root`
  defaults provider, does the same to a virtual-scroll list in a dialog under
  any `VDialog` default, so JSKIT sets none either: `material.css` draws a
  dialog's card (and every card's 12dp corners, which a `rounded` default
  would make an inline style). shell-web's browser test "a virtual-scroll list
  in a dialog reaches its last item after the page around it re-renders"
  guards it; it fails with `VDialog: { VCard: {} }` in the defaults.

## Maintaining the icon set

`src/client/symbols.js` is generated. Add a glyph to
`scripts/generate-symbols.mjs`, then run
`npm run symbols:generate --workspace @jskit-ai/material-web`; the package test
fails while the file is stale.
