# CRUD Scaffolding Patterns

Use when:

- creating a new CRUD-backed entity
- deciding how to create a CRUD table
- deciding whether to scaffold server first or UI first
- deciding whether a CRUD needs a migration, a generator, or both

Check first:

- the intended ownership model
- the real database table shape
- `jskit show crud-server-generator --details`
- whether the request is server-only CRUD or server-plus-UI CRUD

Rules:

- For a CRUD-backed entity, start with `jskit generate crud-server-generator scaffold ...`.
- Unless the table is already owned by a JSKIT baseline package or is an explicit narrow exception recorded in `.jskit/table-ownership.json`, every persisted app-owned table must go through that server CRUD step first.
- That server scaffold is the crucial first step even if no CRUD UI will be created yet.
- If the table should already be CRUD-owned but should not expose public CRUD HTTP routes yet, scaffold it with `jskit generate crud-server-generator scaffold ... --internal` instead of dropping to direct knex or a hand-built pseudo-repository.
- Create the real table directly in the database before scaffolding. `crud-server-generator` reads the live table shape.
- If `crud-server-generator` is going to own the CRUD, do not hand-write a separate CRUD migration for that table. The generator installs and manages the CRUD migration scaffold itself.
- Do not scaffold CRUD UI, hand-build CRUD routes, or hand-build CRUD endpoints before the server CRUD package and shared resource file exist.
- Treat the generated shared resource file as the canonical CRUD contract for later UI scaffolding and CRUD behavior changes.
- `feature-server-generator` is not the default lane for ordinary persisted entities. Use it for workflows or orchestration that sit on top of CRUD-owned tables, or for rare explicit non-CRUD exceptions.
- Generated CRUD UI must be compact-first. Lists need searchable cards on compact widths and tables only for medium/expanded layouts.
- Generated CRUD list screens need real loading, empty, and error states. Empty copy should name the resource, such as "No customers yet", and offer the create action when available.
- Generated CRUD view/new/edit screens should use page headers plus direct sheet panels. Do not use generic card shells as the page architecture.
- Compact CRUD actions should be reachable without a drawer. Use a mobile-visible primary action or FAB for create flows.
- Row actions should be declared with `defineCrudListRowActions(...)` in a page-local `listRowActions.js` and passed into `useCrudListScreen(...)`; the shared list screen owns the compact/wide action rendering.
- Use `syntheticRows` for display-only owner/master rows that should appear inside the shared list layout without becoming CRUD records.
- Bulk actions should be declared in the generated page-local `listBulkActions.js`. The generated list owns selection state, keeps selection controls hidden until actions exist, and exposes selected ids/records to action handlers.
- Structured filters should use shared filter definitions and collapse to compact filter controls/sheets when they outgrow simple search. Do not stack dense desktop filter bars on phone widths.
- Use `--navigation-role` for CRUD list placement intent. Main resources can stay `primary`; nested/detail/workflow CRUD routes should usually be `secondary`, `workflow`, or `none`.

Meaning of `--internal`:

- it keeps the generated repository, service, actions, provider, resource, and CRUD migration ownership chain
- it only suppresses public HTTP CRUD route registration
- it is not a substitute for ownership columns or action/route permissions

When a weird-custom persistence lane is proposed:

- Treat hand-written repositories for persisted app-owned entity tables as an exception path, not a normal choice.
- That includes things like:
  - direct knex instead of generated CRUD ownership
  - a custom repository/service/provider stack for a normal persisted entity table
  - inherited-ownership or mixed-visibility workarounds that dodge the standard CRUD ownership model
- Before taking that path, stop and ask the developer for explicit approval.
- Record the exact approval and the approved exception in `.jskit/WORKBOARD.md` before coding.
- If that exception changes the durable architecture rather than only the current chunk, record it in `.jskit/APP_BLUEPRINT.md` too.
- Without that explicit approval record, do not take the weird-custom persistence path.

Avoid:

- writing a hand migration for a CRUD table that JSKIT CRUD scaffolding is supposed to own
- starting with `crud-ui-generator` before the server scaffold exists
- hand-building CRUD routes or validators that duplicate the generated server resource contract
- letting a new app-owned table exist in the live database without either generated CRUD ownership or a documented `.jskit/table-ownership.json` exception
- accepting table-only CRUD UI as "done" when the route is visible on phone widths
