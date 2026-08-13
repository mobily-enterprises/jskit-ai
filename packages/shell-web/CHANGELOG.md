# Changelog

## 0.1.151 - 2026-08-13

- Replace Vuetify's oversized default drawer icon spacer with one public `navigationItemSpacing` value, defaulting to 12px for both icon-to-label and widest-label-to-edge spacing.
- Keep the Material 3 80px default rail while documenting `railWidth` as the supported product-density override.

## 0.1.150 - 2026-08-13

- Give shell navigation tooltips one opaque, theme-owned Material color pair on hover and keyboard focus.
- Centre complete 48px navigation targets and their selected-state indicators in the collapsed desktop rail.
- Size the open drawer from its widest visible label with an approximately 10px end gap, while exposing `drawerWidth` and `railWidth` overrides.
- Dismiss compact navigation with the scrim or Escape and restore focus to the navigation toggle.
- Make the exported adaptive-shell Playwright helper follow rendered breakpoints and wait for stable drawer transitions and geometry.
