# Page Scaffolding Patterns

Use when:

- adding a non-CRUD route page
- adding a placeholder page or screen stub
- adding a menu-linked page
- deciding how a page and its link should fit the current application

Check first:

- the app blueprint route family and chosen surface
- the page-and-placement source pattern
- the current placement declarations and topology
- the nearest existing routed host under `src/pages`

Rules:

- Start from the package-owned page-and-placement pattern for a new app-owned
  non-CRUD route, then adapt the page and placement as ordinary source.
- Create both the page file and matching `src/placement.js` entry when the page
  belongs in navigation.
- Choose the page's product navigation role deliberately: primary for main
  destinations, secondary for lower-priority shell links, and detail,
  workflow, or no placement when the page should not appear in navigation.
- Inspect the installed packages' public placement declarations before using
  a semantic slot. Target concrete outlets only for deliberate infrastructure.
- If the page sits under an existing routed host, reuse its `page.section-nav`
  ownership rather than creating a parallel navigation structure.
- For a small placeholder route inside an existing route family, keep the change scoped unless the durable route or surface plan in the app blueprint changed.
- Live pages must be usable screens, not instructional scaffolds. Do not ship copy such as "replace this", "use this area", or "this page is ready".
- Prefer a page header plus a direct `v-sheet` working region. Do not wrap every page in a generic `v-card`.
- If the screen is not implemented yet, use a product-shaped empty state with one clear next action or status, not developer instructions.
- Primary navigation links belong in semantic placements such as `shell.primary-nav` or `page.section-nav`; do not place every route into one drawer by default.
- Compact layouts must be checked first: no horizontal overflow, no unreachable primary action, and tap targets should be at least 48 px.

UI contract:

- App-facing screens are phone-first and task-first; admin/console screens may be denser but still need responsive controls.
- Navigation uses semantic placements by default. Raw `host:position` outlets are advanced infrastructure.
- Page architecture is header plus direct work region, normally `v-sheet`; do not use generic page-level `v-card` shells.
- Empty/loading/error states are product-shaped and resource-named.
- Detail and workflow routes are not primary navigation by default.
- Changed UI must have compact, medium, and expanded browser checks when it changes user-facing behavior.

Avoid:

- inventing a page and placement shape without checking the existing pattern and neighboring routes
- treating a small page stub as permission to rewrite marketing copy, route architecture, or app blueprint scope
- adding cards inside cards or repeating the page title inside a card title
- treating Vuetify component defaults as the product architecture
