# Changelog

## Unreleased

- `theme.typography: { brand, plain }` names Material 3's brand typeface (display, headline, title-large) and plain one (title-medium and -small, body, label) as CSS font-family values, both Roboto Flex by default. They become the theme variables `--v-font-heading` and `--v-font-body`, which Vuetify's type classes read; `material.css` keeps Roboto Flex for both only as a fallback in the `vuetify-core` layer, so an app's typefaces win. Upgrading: an app with its own fonts names them here instead of overriding `--v-font-body` or `font-family` in CSS.
- Cards have no default `elevation`: Vuetify's elevated variant (the default) keeps its level-1 shadow, and flat, tonal and outlined cards (banners, heroes, containers) have none, as Material 3 draws them; the same for cards in a bottom sheet.
- FABs keep Material 3's sizes instead of the common button's 40dp: 56dp, small 40dp, large 96dp (36dp icon), and the extended FAB 56dp tall.
- Small, x-small and large buttons get the 48dp touch target that default and icon buttons have, as a transparent hit area around the unchanged visual; stacked buttons are left as they are. The hit area is ink overflow (layout containment), so a button at the edge of a window or scroll container adds no scrollbar.
- A button label stays on one line and ends in an ellipsis when it is longer than its button, instead of spilling out of it.
- A theme colour can keep its own hue: `colors: { learning: { value: "#F5C518", blend: false } }` still gets its four roles, light and dark, without the shift toward the seed (Material Theme Builder's Blend switched off). A hex string, or `{ value }`, stays harmonized as before.

## 0.1.0

- New package: exact Material 3 for JSKIT Vuetify apps. `createMaterialVuetifyOptions({ seed, colors, icons })` generates the light and dark schemes from one seed with Material Color Utilities (the app's own `colors` as harmonized custom colours, light and dark), follows the system scheme, maps every icon alias to Material Symbols Rounded, and sets JSKIT's Material 3 component defaults; `client/material.css` adds the exact sizes and shapes (40dp buttons and 32dp chips inside 48dp touch targets, outline-variant dividers), Roboto Flex and motion.
