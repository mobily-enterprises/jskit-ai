# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- The error host, menus, navigation and not-found/loading screens are translated; placement `label`/`title` may be a key, `{ key, fallback, params }` or plain text.

### New message keys (31)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.shell.actions.close`
- `jskit.shell.actions.dismiss`
- `jskit.shell.actions.reload`
- `jskit.shell.actions.retry`
- `jskit.shell.error.actionFailed`
- `jskit.shell.error.attentionRequired`
- `jskit.shell.error.navigationFailed`
- `jskit.shell.error.requestFailed`
- `jskit.shell.error.unexpectedUi`
- `jskit.shell.layout.closeNavigationMenu`
- `jskit.shell.layout.collapseNavigationDrawer`
- `jskit.shell.layout.details`
- `jskit.shell.layout.expandNavigationDrawer`
- `jskit.shell.layout.openNavigationMenu`
- `jskit.shell.layout.surface`
- `jskit.shell.layout.tab`
- `jskit.shell.layout.tools`
- `jskit.shell.pullToRefresh.pull`
- `jskit.shell.pullToRefresh.refreshing`
- `jskit.shell.pullToRefresh.release`
- `jskit.shell.recovery.appDataLabel`
- `jskit.shell.recovery.appLabel`
- `jskit.shell.recovery.appModuleLabel`
- `jskit.shell.recovery.appUnreachable`
- `jskit.shell.recovery.errorConfigLabel`
- `jskit.shell.recovery.moduleFailed`
- `jskit.shell.recovery.placementConfigLabel`
- `jskit.shell.recovery.placementTopologyLabel`
- `jskit.shell.recovery.refreshFailed`
- `jskit.shell.recovery.reloadFailed`
- `jskit.shell.recovery.unreachable`

</details>

## 0.1.152 - 2026-08-13

- Remove the redundant uppercase surface subheader from the expanded drawer; the top app bar remains the single shell-owned surface label.
- Align expanded drawer icons to the collapsed rail centreline so toggling navigation reveals or hides labels without shifting the icons horizontally.
- Preserve the Material 3 80px default rail and the public `railWidth` and `navigationItemSpacing` density controls.

## 0.1.151 - 2026-08-13

- Replace Vuetify's oversized default drawer icon spacer with one public `navigationItemSpacing` value, defaulting to 12px for both icon-to-label and widest-label-to-edge spacing.
- Keep the Material 3 80px default rail while documenting `railWidth` as the supported product-density override.

## 0.1.150 - 2026-08-13

- Give shell navigation tooltips one opaque, theme-owned Material color pair on hover and keyboard focus.
- Centre complete 48px navigation targets and their selected-state indicators in the collapsed desktop rail.
- Size the open drawer from its widest visible label with an approximately 10px end gap, while exposing `drawerWidth` and `railWidth` overrides.
- Dismiss compact navigation with the scrim or Escape and restore focus to the navigation toggle.
- Make the exported adaptive-shell Playwright helper follow rendered breakpoints and wait for stable drawer transitions and geometry.
