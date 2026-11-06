# Changelog

## Unreleased

- A theme colour can keep its own hue: `colors: { learning: { value: "#F5C518", blend: false } }` still gets its four roles, light and dark, without the shift toward the seed (Material Theme Builder's Blend switched off). A hex string, or `{ value }`, stays harmonized as before.

## 0.1.0

- New package: exact Material 3 for JSKIT Vuetify apps. `createMaterialVuetifyOptions({ seed, colors, icons })` generates the light and dark schemes from one seed with Material Color Utilities (the app's own `colors` as harmonized custom colours, light and dark), follows the system scheme, maps every icon alias to Material Symbols Rounded, and sets JSKIT's Material 3 component defaults; `client/material.css` adds the exact sizes and shapes (40dp buttons and 32dp chips inside 48dp touch targets, outline-variant dividers), Roboto Flex and motion.
