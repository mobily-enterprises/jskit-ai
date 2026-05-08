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
