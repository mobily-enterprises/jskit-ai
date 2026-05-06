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
- baseline package-owned workflows and any intended overrides
- delivery plan broken into chunks
- CRUD-specific operation and screen decisions where relevant

Scoping rules:

- Use `guide/agent/index.md` for fast navigation and `site/guide/index.md` for exact details.
- Inspect packages and generators before choosing them.
- Make the generator plan concrete. Name the exact `jskit` commands expected for the chunk, not just a package or a general idea.
- For non-CRUD route page work, check `jskit show ui-generator --details` and `jskit list-placements` before deciding that custom page or placement code is necessary.
- For CRUD work, make the server-first plan explicit. Name the exact `jskit generate crud-server-generator scaffold ...` command before any CRUD UI plan.
- Before accepting a new persisted app-owned table, decide whether it is CRUD-owned or a narrow explicit exception. If it is not already owned by a JSKIT baseline package, the default answer should be server CRUD ownership.
- If a CRUD will be owned by `crud-server-generator`, plan around a real table that already exists in the database. Do not plan a separate hand-written CRUD migration for that table.
- Decide ownership early; do not treat it as a UI-only detail.
- If Stage 1 platform choices are still provisional, finish them before installing tenancy-sensitive runtime packages.
- Record which selected JSKIT package-owned workflows are accepted as baseline and which, if any, need custom behavior.
- Do not ask the developer to redesign package-owned baseline workflows from scratch. Ask only whether the default behavior is accepted or whether the app needs overrides, restrictions, or extensions.
- Create or refresh `.jskit/WORKBOARD.md` for substantial or multi-chunk work so the request has an explicit execution tracker.
- Do not rewrite `.jskit/APP_BLUEPRINT.md` for a one-off placeholder page inside an already planned route family unless the durable route plan, surface plan, or ownership model changed.
- Break delivery into chunks that can be independently reviewed and tested.
- One CRUD is usually one chunk. Platform setup, shell work, and cross-cutting integrations may also be separate chunks.
- For each CRUD chunk, decide these before implementation:
  - which operations exist: `list`, `view`, `new`, `edit`, `delete`, or a narrower set
  - which fields appear in the list view if a list exists
  - the intended structure and visual hierarchy of the view form
  - the intended structure and visual hierarchy of the edit/new form
- If the package/runtime choice is unclear, stop and resolve it before writing implementation code.

No feature implementation should start until the blueprint covers database, screens, functional boundaries, and chunk plan well enough that the implementation path is obvious.
