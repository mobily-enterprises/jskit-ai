# Changelog

## Unreleased

- `jskit check` counts a layout that renders shell-web's `ShellUpButton` in a top app bar of its own, directly or through an app component it imports, as a shell layout: its pages need parents and are counted as shell pages.
- `nav/back-control` flags only controls that navigate the app (a link, or a handler that reaches the router, JSKIT paths, `up()`, `finish()` or the browser's history or location, directly or through the component's own functions) and back-named functions that do. Prose, variables, in-page steps and an embedded frame's own history (`contentWindow.history`) are no longer findings. Its messages name `ShellUpButton` for layouts that draw their own bar.

## 0.2.0 - 2026-10-29

- Translation tooling for JSKIT apps.
- New CLI commands: `jskit i18n export <locale>` writes the merged English of the app's installed packages to `src/locales/<locale>/jskit.json`; `jskit i18n check <locale>` reports missing/extra keys and placeholder or plural mismatches.
