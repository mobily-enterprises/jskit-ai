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
- App surfaces should be phone-first and task-first: lower chrome, bottom primary navigation on compact layouts, and prominent task actions.
- Admin and console surfaces can be denser and more utilitarian, but they still need responsive controls and must not become generic drawer-only mobile UIs.
- Settings surfaces should expose section navigation, direct controls, and real saved state. Avoid fake overview cards and instructional placeholder copy.
- Utility/status widgets belong in semantic status/action placements such as `shell.status` or `shell.global-actions`, not primary navigation.

Ask explicitly about:

- route pages
- menu entries
- top-left/top-right widgets
- settings pages
- CRUD screens
- helper components that only make sense on one surface
