# Scoping Workflow

Before implementing any feature or batch of features, create or update an app-local working blueprint using `templates/APP_BLUEPRINT.md` as the template.

Recommended location:

- `.jskit/APP_BLUEPRINT.md`
- `.jskit/WORKBOARD.md` for per-request progress tracking

Do not edit the vendor template in `node_modules/` directly.

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
- delivery plan broken into chunks

Scoping rules:

- Use `guide/agent/index.md` for fast navigation and `guide/human/index.md` for exact details.
- Inspect packages and generators before choosing them.
- Decide ownership early; do not treat it as a UI-only detail.
- If Stage 1 platform choices are still provisional, finish them before installing tenancy-sensitive runtime packages.
- Create or refresh `.jskit/WORKBOARD.md` for substantial or multi-chunk work so the request has an explicit execution tracker.
- Break delivery into chunks that can be independently reviewed and tested.
- One CRUD is usually one chunk. Platform setup, shell work, and cross-cutting integrations may also be separate chunks.
- If the package/runtime choice is unclear, stop and resolve it before writing implementation code.

No feature implementation should start until the blueprint covers database, screens, functional boundaries, and chunk plan well enough that the implementation path is obvious.
