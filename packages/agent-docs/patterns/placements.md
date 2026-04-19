# Placement Patterns

Use when:

- changing tab icons
- changing menu link icons or labels
- moving shell links
- changing profile or settings menu entries
- debugging why a visible link does not match the page component

Check first:

- app `src/placement.js`
- package placement contributions
- linked component token props

Rules:

- In JSKIT, tab-like links and shell/menu entries are often placement-owned, not page-owned.
- When asked to change a tab or menu icon, inspect placement metadata before editing page components.
- Look at placement `props`, especially fields such as `icon`, `prependIcon`, `appendIcon`, or props passed into the linked component token.
- If the visible entry is contributed by a package, update the owning package placement contribution instead of patching a local page component.
- If the request is really about where a link appears, check the placement `target`, `surfaces`, `order`, and `when` fields before changing UI markup.

Avoid:

- editing the routed page just to change a shell/tab/menu icon that is actually placement-owned
- assuming a rendered tab label/icon lives in the page component
