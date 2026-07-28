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

## Non-negotiable database contract

Before database, schema, CRUD, repository, or persistence work, read this
pattern completely. Use the database selected for this app's development
runtime; never alter a production, legacy, historical, or other valuable
database to develop or verify schema changes. Prove the complete migration
chain against a fresh disposable database before reporting completion.

For normal app-owned CRUD tables:

- use exactly one non-null integer primary-key column, normally
  `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`
- make every foreign key single-column and point it directly to the referenced
  table's single-column primary key
- use multi-column unique indexes only for business uniqueness, never as
  relationship targets
- use only direct `workspace_id` and/or `user_id` columns for generated JSKIT
  ownership, and select the ownership filter that matches those columns exactly
- express tenant-safe relationships as direct ownership plus a normal
  `parent_id -> parent.id` relationship; resolve related IDs through the
  workspace-scoped service and test both allowed and cross-workspace cases

Do not use composite primary keys or composite foreign keys to encode tenant
ownership, target a business key from a foreign key, or duplicate parent
identity when the related row ID already identifies it. Stop before generation
if the proposed table violates these constraints.

Rules:

- For a CRUD-backed entity, create the validated table in the managed
  development database first. Then make
  `jskit generate crud-server-generator scaffold ...` the first JSKIT scaffold.
- Unless the table is already owned by a JSKIT baseline package or is an explicit narrow exception recorded in `.jskit/table-ownership.json`, every persisted app-owned table must go through that server CRUD step first.
- That server scaffold is the crucial first step even if no CRUD UI will be created yet.
- If the table should already be CRUD-owned but should not expose public CRUD HTTP routes yet, scaffold it with `jskit generate crud-server-generator scaffold ... --internal` instead of dropping to direct knex or a hand-built pseudo-repository.
- Create the real table directly in the database before scaffolding. `crud-server-generator` reads the live table shape.
- If `crud-server-generator` is going to own the CRUD, do not hand-write a separate CRUD migration for that table. The generator installs and manages the CRUD migration scaffold itself.
- Never modify or replace a generator-owned baseline migration after it has
  been installed. Later schema evolution must use a new immutable,
  package-owned additive migration declared through `install-migration`.
- Keep generated table creation in `migrations/` and generated foreign keys in
  `migrations/constraints/`. The database runtime deliberately runs those
  phases in that order so valid mutual foreign keys rebuild cleanly without
  disabling constraint checks.
- Do not scaffold CRUD UI, hand-build CRUD routes, or hand-build CRUD endpoints before the server CRUD package and shared resource file exist.
- Treat the generated shared resource file as the canonical CRUD contract for later UI scaffolding and CRUD behavior changes.
- Treat the exact columns `workspace_id` and `user_id` as reserved JSKIT ownership columns. They are the only standard columns used for generated ownership filtering and create-time owner stamping.
- Treat other foreign keys such as `recipient_user_id`, `created_by_user_id`, `assignee_user_id`, and similarly specific names as domain relationships, not ownership aliases. Do not rename a relationship to `user_id` or `workspace_id` merely to satisfy tooling.
- Require the resolved ownership filter to match the reserved columns exactly: neither the filter nor the schema may silently add or omit `workspace_id` or `user_id` ownership.
- `feature-server-generator` is not the default lane for ordinary persisted entities. Use it for workflows or orchestration that sit on top of CRUD-owned tables, or for rare explicit non-CRUD exceptions.
- Generated CRUD UI must be compact-first. Lists need searchable cards on compact widths and tables only for medium/expanded layouts.
- Generated CRUD list screens need real loading, empty, and error states. Empty copy should name the resource, such as "No customers yet", and offer the create action when available.
- Generated CRUD view/new/edit screens should use page headers plus direct sheet panels. Do not use generic card shells as the page architecture.
- Permission-gated generated CRUD lists should pass `readEnabled` into `useCrudListScreen(...)` instead of replacing the shared list wrapper.
- Compact CRUD actions should be reachable without a drawer. Use a mobile-visible primary action or FAB for create flows.
- Row actions should be declared with `defineCrudListRowActions(...)` in a page-local `listRowActions.js` and passed into `useCrudListScreen(...)`; the shared list screen owns the compact/wide action rendering.
- Use `syntheticRows` for display-only owner/master rows that should appear inside the shared list layout without becoming CRUD records.
- Bulk actions should be declared in the generated page-local `listBulkActions.js`. The generated list owns selection state, keeps selection controls hidden until actions exist, and exposes selected ids/records to action handlers.
- Structured filters should use shared filter definitions and collapse to compact filter controls/sheets when they outgrow simple search. Do not stack dense desktop filter bars on phone widths.
- Use `--navigation-role` for CRUD list placement intent. Main resources can stay `primary`; nested/detail/workflow CRUD routes should usually be `secondary`, `workflow`, or `none`.

## Baseline generation versus later schema evolution

The initial CRUD scaffold and a later schema change are different operations:

- The server generator owns the baseline migration that recreates the table
  from zero. Do not edit, replace, or regenerate that installed baseline to
  express a later change.
- The table's app-local package owns later schema evolution. Create each change
  as a new immutable additive migration:

  ```bash
  npx jskit create migration \
    --package @local/workflow-record-report-values \
    --id extend-report-value-field-types
  ```

- The authoring command creates an editable migration template and adds its
  `install-migration` mutation to the owning package descriptor in one
  operation. Implement and test the template before materializing it.
- Materialize the completed source with
  `npx jskit migrations package <package-id>`, then apply it with
  `npm run db:migrate`.
- SQL or Knex schema operations inside that source-controlled migration are
  supported. Ad-hoc SQL applied only to one database is not: it creates schema
  drift and leaves fresh installations incorrect.
- Installed migration ids and content are immutable. A correction to an
  installed migration is another additive migration with a new id.

A package-owned additive migration is not the prohibited "separate CRUD
migration." The prohibition applies to competing with or modifying the
generator-owned baseline.

Meaning of `--internal`:

- it keeps the generated repository, service, actions, provider, resource, and CRUD migration ownership chain
- it only suppresses public HTTP CRUD route registration
- it is not a substitute for ownership columns or action/route permissions
- it does not suppress generated action permission ids or decide which role receives them

Workspace role grants:

- every workspace-required CRUD generation must explicitly choose `--grant-role <role-id>` or `--no-role-grant`
- applications that assign generated CRUD permissions to `member` must say `--grant-role member`; fixed-role applications must name one of their real roles or choose no automatic grant
- `--grant-role` and `--no-role-grant` are permission-design choices independent of `--internal`
- never invent a `member` role only to satisfy the generator

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
- Record durable, approved schema exceptions in `.jskit/APP_BLUEPRINT.md` as
  well as the table-ownership exception; an exception must not silently weaken
  the normal generated CRUD contract.

Before reporting completion:

- verify there are no composite primary or foreign keys in the generated CRUD
  tables
- verify every generated CRUD foreign key targets a single-column primary key
- apply the generated migrations from zero to a fresh disposable database
- compare the recreated schema with the intended development schema
- run positive and negative cross-workspace relationship tests where ownership
  applies, then run JSKIT Doctor and the project's normal verifier

Avoid:

- writing a hand migration for a CRUD table that JSKIT CRUD scaffolding is supposed to own
- starting with `crud-ui-generator` before the server scaffold exists
- hand-building CRUD routes or validators that duplicate the generated server resource contract
- letting a new app-owned table exist in the live database without either generated CRUD ownership or a documented `.jskit/table-ownership.json` exception
- accepting table-only CRUD UI as "done" when the route is visible on phone widths
