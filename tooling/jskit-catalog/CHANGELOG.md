# Changelog

## Unreleased

- `nav/placement-data` (new): a main-navigation placement that isn't literal data (built by a helper, spread, interpolated, or with computed props, suffixes or surface) is a finding that says to declare it literally. While one is unreadable, no page is judged for `nav/missing-parent`, instead of each of its destinations being reported as missing a parent.
- `nav/missing-shell-layout` (new): a page that declares a parent but renders under no layout that draws the shell's top app bar (an account page without `src/pages/account.vue`) is a finding, since its title, Up and page actions never show. An `App.vue` that wraps every page in the bar leaves none outside it.
- `m3/duplicate-h1` flags an in-page `h1` only under the shell's page title: in a file that shows it, a page a layout showing it (`ShellLayout`, or `ShellPageTitle` in a bar of its own) renders, or a component such a file imports. A hero front page, an intro, an invite or hand-off page without a top app bar, and the components only they render, keep their `h1`. A component no `.vue` file imports is still judged as under the title.
- `m3/raw-hex` findings name `src/theme/palettes.js`, the sanctioned home of content colours (identity palettes, artwork, brand marks, chart series), which, like the rest of `src/theme/`, may hold hex values.
- `nav/top-level-parent`: a main-navigation link that names its surface (`props.surface`) is a destination of that surface only, wherever it shows, as the runtime resolves it; a Home link also shown on an account surface no longer makes the account page a destination.
- `m3/fixed-button-height` findings say that a smaller button is `size="small"` or `"x-small"`, which keeps the touch target.
- `jskit check` counts a layout that renders shell-web's `ShellUpButton` in a top app bar of its own, directly or through an app component it imports, as a shell layout: its pages need parents and are counted as shell pages.
- `nav/back-control` flags only controls that navigate the app (a link, or a handler that reaches the router, JSKIT paths, `up()`, `finish()` or the browser's history or location, directly or through the component's own functions) and back-named functions that do. Prose, variables, in-page steps and an embedded frame's own history (`contentWindow.history`) are no longer findings. Its messages name `ShellUpButton` for layouts that draw their own bar.

## 0.2.0 - 2026-10-29

- Translation tooling for JSKIT apps.
- New CLI commands: `jskit i18n export <locale>` writes the merged English of the app's installed packages to `src/locales/<locale>/jskit.json`; `jskit i18n check <locale>` reports missing/extra keys and placeholder or plural mismatches.
