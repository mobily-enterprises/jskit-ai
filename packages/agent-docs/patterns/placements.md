# Placement Patterns

Use when:

- changing tab icons
- changing menu link icons or labels
- moving shell links
- changing profile or settings menu entries
- debugging why a visible link does not match the page component

Check first:

- app `src/placement.js`
- app `src/placementTopology.js`
- package placement contributions
- package placement topology
- linked component token props

Mental model:

- `src/placement.js` answers "what is being placed?"
- `src/placementTopology.js` answers "where does this semantic placement render for compact, medium, and expanded layouts?"
- `<ShellOutlet target="host:position" />` is the concrete recipient rendered by Vue.
- Semantic ids use dot notation, for example `shell.primary-nav`, `shell.status`, `page.section-nav`, `settings.sections`.
- Concrete outlet ids use colon notation, for example `shell-layout:primary-menu`, `shell-layout:top-right`, `home-settings:primary-menu`.
- Authoring should target semantic placements by default. Concrete outlets are an advanced escape hatch.

Placement entries:

- Add entries with `addPlacement(...)` in `src/placement.js`.
- Use `target: "area.slot"` for normal entries.
- Use `owner` when the semantic placement is scoped to a specific host, for example `target: "page.section-nav", owner: "home-settings"`.
- Use `kind: "link"` for navigation/menu/tab links. Do not add a link renderer token to the entry unless there is a deliberate override.
- Use `kind: "component"` for widgets/sections/elements. These entries require `componentToken`.
- Use `surfaces` to say where the entry is eligible. Missing or `["*"]` means any surface.
- Use `order` for ordering. Equal order preserves source order.
- Use `props` for the rendered component props, including labels, icons, `surface`, `scopedSuffix`, `unscopedSuffix`, or explicit `to`.
- Use `when(context)` only for auth, permissions, feature flags, and runtime state. Do not use `when()` for layout adaptation.
- Direct concrete placement must use `target: "host:position"` plus `internal: true`. Treat this as low-level infrastructure, not normal app authoring.

Placement topology:

- `src/placementTopology.js` should be append-friendly: keep a `placements` array, export `addPlacementTopology(value)`, and append `addPlacementTopology(...)` blocks at the bottom.
- Every semantic placement topology entry needs `id`, optional `owner`, optional `description`, `surfaces`, and all three variants: `compact`, `medium`, and `expanded`.
- Every variant needs an `outlet: "host:position"`.
- Variant `renderers` maps semantic `kind` values to component tokens, for example `renderers: { link: "local.main.ui.surface-aware-menu-link-item" }`.
- Renderer choice for semantic `kind: "link"` placements belongs in topology, not in each placement entry.
- `default: true` marks the fallback semantic placement that page generators use when no nearer host applies.
- Package topology is discovered too, but app topology with the same `id` and `owner` overrides package topology in CLI discovery.

Runtime behavior:

- The shell runtime loads `/src/placementTopology.js` and `/src/placement.js`.
- Each `ShellOutlet` asks for placements by concrete `target`, current `surface`, and current layout class.
- Layout classes are `compact`, `medium`, and `expanded`.
- For semantic entries, runtime matches topology by `target`, `owner`, and `surface`, then chooses the current layout variant.
- A semantic entry renders only when the selected variant's `outlet` equals the concrete `ShellOutlet target`.
- Runtime resolves the component token as `entry.componentToken || variant.renderers[entry.kind]`.
- Entries without a resolvable component token do not render.
- `when()` receives placement context including `app`, `surface`, `target`, `layoutClass`, runtime context, local outlet context, and context contributors.

CLI and generators:

- `jskit list-placements` shows semantic placements by default.
- `jskit list-placements --concrete` shows concrete `ShellOutlet` recipients.
- `jskit list-placements --all` shows both.
- `jskit list-placements --json` returns structured semantic and concrete placement data.
- `ui-generator page`, CRUD UI list generation, and assistant page generation target semantic placements.
- `--link-placement` for generated pages is a semantic placement id, not a concrete outlet id.
- If a generated page is under a parent host with a mapped `ShellOutlet`, the generator infers the semantic placement and owner from topology.
- `ui-generator add-subpages` upgrades a page into a routed child-page host and appends a `page.section-nav` topology entry for the generated concrete outlet.
- `ui-generator outlet` injects a plain concrete `ShellOutlet` and appends the semantic topology mapping in the same command.
- When adding a public concrete outlet by hand, add its semantic topology mapping in the same change.

Rules:

- In JSKIT, tab-like links and shell/menu entries are often placement-owned, not page-owned.
- When asked to change a tab or menu icon, inspect placement metadata before editing page components.
- Look at placement `props`, especially fields such as `icon`, `prependIcon`, `appendIcon`, or props passed into the linked component token.
- If the visible entry is contributed by a package, update the owning package placement contribution instead of patching a local page component.
- If the request is really about where a link appears, check the placement `target`, `owner`, `surfaces`, `order`, and `when` fields before changing UI markup.
- Placement targets should be semantic by default, such as `shell.primary-nav` or `page.section-nav`; concrete `host:position` outlets are the advanced escape hatch.
- Renderer choice for semantic `kind: "link"` placements belongs in topology, not in each placement entry.
- Adding a public concrete `ShellOutlet` should happen with a matching semantic topology entry in the same change.

Avoid:

- editing the routed page just to change a shell/tab/menu icon that is actually placement-owned
- assuming a rendered tab label/icon lives in the page component
- adding a public `ShellOutlet` without also exposing a semantic placement that maps to it
