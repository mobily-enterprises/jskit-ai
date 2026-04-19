# Surface Patterns

Use when:

- adding a new screen or feature
- generating pages
- adding menu entries or widgets
- deciding whether something belongs in `home`, `app`, `admin`, `console`, or another surface

Check first:

- the blueprint surface plan
- existing route roots under `src/pages`
- placement visibility by `surfaces`

Rules:

- Always ask which surface the feature belongs to before generating routes, placements, or related UI.
- Do not silently default new functionality to `app`.
- Surface choice is architectural, not cosmetic. It controls routes, access, placement visibility, and often data ownership expectations.
- When a link or widget should only appear on certain surfaces, use placement `surfaces` first and keep runtime `when` conditions for behavior-specific gating.

Ask explicitly about:

- route pages
- menu entries
- top-left/top-right widgets
- settings pages
- CRUD screens
- helper components that only make sense on one surface
