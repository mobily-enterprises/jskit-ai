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
  buttons, elevated cards on `surface-container-low` with 12dp corners, outlined
  fields, 8dp chips that close with `$close`, 4dp menus on `surface-container`,
  the inverse-surface snackbar, the Material switch and the 16dp
  `primary-container` FAB.
- **`material.css`.** What props cannot set: 40dp buttons and 40dp icon
  buttons, a 48dp touch target on every button size (small and x-small keep
  their look), one-line labels that end in an ellipsis, 28dp dialogs and
  bottom sheets, square
  full-screen dialogs on `surface`, a 48dp touch target on clickable chips,
  inverse-surface tooltips, emphasized easing
  and reduced motion. Its component rules sit in Vuetify's `vuetify-overrides`
  cascade layer, so an app's own props and utility classes still win; nothing
  uses `!important` or Sass.

## Maintaining the icon set

`src/client/symbols.js` is generated. Add a glyph to
`scripts/generate-symbols.mjs`, then run
`npm run symbols:generate --workspace @jskit-ai/material-web`; the package test
fails while the file is stale.
