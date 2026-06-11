# Page Scaffolding Patterns

Use when:

- adding a non-CRUD route page
- adding a placeholder page or screen stub
- adding a menu-linked page
- deciding whether a page and its link should be generated or hand-written

Check first:

- the app blueprint route family and chosen surface
- `jskit show ui-generator --details`
- `jskit list-placements`
- the nearest existing routed host under `src/pages`

Rules:

- Default to `jskit generate ui-generator page ...` for a new app-owned non-CRUD route page.
- Let the generator create both the page file and the matching `src/placement.js` entry, then adapt the generated output if needed.
- Choose the generated page's product navigation role deliberately. Use `--navigation-role primary` for main destinations, `secondary` for lower-priority shell links, and `detail`, `workflow`, or `none` when the page should not appear in navigation.
- If the page link belongs in a non-default semantic slot, discover the public placement first with `jskit list-placements` and pass `--link-placement`.
- If you need the concrete outlet inventory, use `jskit list-placements --concrete`; do not target concrete outlets by default.
- If the page sits under an existing routed host, check whether `ui-generator page` can infer the correct `page.section-nav` owner before writing a custom link by hand.
- If you do not use `ui-generator page`, state exactly why the generator does not fit before editing code.
- For a small placeholder route inside an existing route family, keep the change scoped unless the durable route or surface plan in the app blueprint changed.
- Generated live pages must be usable screens, not instructional scaffolds. Do not ship copy such as "replace this", "use this area", or "this page is ready".
- Prefer a page header plus a direct `v-sheet` working region. Do not wrap every generated page in a generic `v-card`.
- If the screen is not implemented yet, use a product-shaped empty state with one clear next action or status, not developer instructions.
- Primary navigation links belong in semantic placements such as `shell.primary-nav` or `page.section-nav`; do not place every generated route into one drawer by default.
- Compact layouts must be checked first: no horizontal overflow, no unreachable primary action, and tap targets should be at least 48 px.

Generated UI contract:

- App-facing screens are phone-first and task-first; admin/console screens may be denser but still need responsive controls.
- Navigation uses semantic placements by default. Raw `host:position` outlets are advanced infrastructure.
- Page architecture is header plus direct work region, normally `v-sheet`; do not use generic page-level `v-card` shells.
- Empty/loading/error states are product-shaped and resource-named.
- Detail and workflow routes are not primary navigation by default.
- Generated UI must have compact, medium, and expanded browser checks when it changes user-facing behavior.

Avoid:

- hand-writing both `src/pages/...` and `src/placement.js` for a normal non-CRUD page before checking `ui-generator`
- treating a small page stub as permission to rewrite marketing copy, route architecture, or app blueprint scope
- claiming that no generator exists without checking the actual `jskit` generator inventory first
- adding cards inside cards or repeating the page title inside a card title
- treating Vuetify component defaults as the product architecture
