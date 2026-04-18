# Scoping Workflow

Before implementing any feature or batch of features, write or update `templates/APP_BLUEPRINT.md` as the working app blueprint.

The blueprint must capture at least:

- product purpose
- actors and permissions
- tenancy mode
- database engine
- auth choice
- core surfaces and route families
- core entities
- ownership model per entity: `public`, `user`, `workspace`, or `workspace_user`
- package install plan
- generator plan
- custom-code areas

Scoping rules:

- Use `guide/agent/index.md` for fast navigation and `guide/human/index.md` for exact details.
- Inspect packages and generators before choosing them.
- Decide ownership early; do not treat it as a UI-only detail.
- If the package/runtime choice is unclear, stop and resolve it before writing implementation code.

No feature implementation should start until the blueprint covers database, screens, and functional boundaries well enough that the implementation path is obvious.
