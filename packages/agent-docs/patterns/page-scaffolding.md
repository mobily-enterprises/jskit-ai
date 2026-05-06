# Page Scaffolding Patterns

Use when:

- adding a non-CRUD route page
- adding a placeholder page or screen stub
- adding a menu-linked page
- deciding whether a page and its link should be generated or hand-written

Check first:

- the blueprint route family and chosen surface
- `jskit show ui-generator --details`
- `jskit list-placements`
- the nearest existing routed host under `src/pages`

Rules:

- Default to `jskit generate ui-generator page ...` for a new app-owned non-CRUD route page.
- Let the generator create both the page file and the matching `src/placement.js` entry, then adapt the generated output if needed.
- If the page link belongs in a non-default outlet, discover the outlet first with `jskit list-placements` and pass `--link-placement`.
- If the page sits under an existing routed host, check whether `ui-generator page` can infer the correct child placement before writing a custom link by hand.
- If you do not use `ui-generator page`, state exactly why the generator does not fit before editing code.
- For a small placeholder route inside an existing route family, update the workboard rather than rewriting the blueprint unless the durable route or surface plan changed.

Avoid:

- hand-writing both `src/pages/...` and `src/placement.js` for a normal non-CRUD page before checking `ui-generator`
- treating a small page stub as permission to rewrite marketing copy, route architecture, or blueprint scope
- claiming that no generator exists without checking the actual `jskit` generator inventory first
