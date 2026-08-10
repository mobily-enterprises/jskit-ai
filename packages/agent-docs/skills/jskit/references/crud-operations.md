# CRUD operations

Read this reference completely before database, schema, CRUD, repository, or
persistence work.

## Establish the contract

Determine the selected database adapter, surface, access rule, and ownership
model from the request and app authority. Inspect only a generator whose exact
lane or option values are missing, or whose supplied command failed:

```bash
npx jskit show crud-server-generator --details
npx jskit show crud-ui-generator --details
```

Never run these merely to reconfirm caller-supplied facts.

For normal app-owned CRUD tables:

- Use one non-null integer primary key, normally
  `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`.
- Make every foreign key single-column and target the referenced table's
  single-column primary key. Use multi-column unique indexes only for business
  uniqueness, never as relationship targets.
- Use only direct `workspace_id` and/or `user_id` columns for generated JSKIT
  ownership and choose the ownership filter matching those columns exactly.
- Treat names such as `recipient_user_id`, `created_by_user_id`, and
  `assignee_user_id` as domain relationships, not ownership aliases.
- Express tenant-safe relationships as direct ownership plus a normal
  `parent_id -> parent.id` relation. Test both allowed and cross-workspace
  cases.

Stop before generation if the schema uses composite relationship keys or if
the ownership filter and reserved ownership columns disagree.

## Conventional one-table CRUD

In a fresh disposable development database, create the validated table first.
The server generator reads its live shape. Scaffold the server contract before
the UI:

```bash
npx jskit generate crud-server-generator scaffold \
  --namespace <resource> \
  --surface <surface> \
  --ownership-filter <public|user|workspace|workspace_user> \
  --access <public|authenticated> \
  --table-name <table>
```

Use `--access public` only with a non-workspace surface and public ownership;
omit both role-grant flags. For workspace-required CRUDs, choose exactly one
of `--grant-role <role>` or `--no-role-grant`. Never invent a role to satisfy
the generator. Use `--internal` when the entity needs the generated
repository/service/resource/migration ownership chain but no public HTTP CRUD
routes.

Run `npm install`, then scaffold the UI from the generated shared resource:

```bash
npx jskit generate crud-ui-generator crud \
  <pages-root>/<plural-route> \
  --resource-file packages/<namespace>/src/shared/<singular>Resource.js \
  --parent-title contextual
```

The target is relative to `src/pages/`, starts with the selected surface's
nonempty configured `pagesRoot`, and has no leading slash (for example
`home/books`). For a surface deliberately configured with an empty root, use
only the plural route (for example `books`). Use the exact singular resource
filename emitted by the server generator; do not guess it.

Treat that shared resource as the canonical CRUD contract. Do not hand-build
routes, validators, HTTP helpers, or UI before the server resource exists.

Use generated high-level seams where they fit:

- `useCrudListScreen()`, `useCrudViewScreen()`, and
  `useCrudAddEditScreen()` for routed screens.
- `useCrudList()`, `useCrudView()`, and `useCrudAddEdit()` for routed CRUD
  behavior.
- `useList()`, `useView()`, `useAddEdit()`, `useCommand()`, and
  `useEndpointResource()` for non-standard contracts.

CRUD hooks derive their JSON:API transport from the shared resource. Do not
pass a custom transport or use raw `fetch()` for standard CRUD behavior.

## Migration ownership

Do not hand-write a competing migration for a table the CRUD server generator
will own. Never modify or replace its installed baseline migration. Express a
later schema change as a new immutable additive migration owned by the
app-local package:

```bash
npx jskit create migration \
  --package <package-id> \
  --id <migration-id>
npx jskit migrations package <package-id>
npm run db:migrate
```

If ordinary persisted data genuinely cannot use the generated CRUD lane, stop
and obtain explicit developer approval. Record the approved exception in
`.jskit/WORKBOARD.md` and `.jskit/table-ownership.json`; also record it in
`.jskit/APP_BLUEPRINT.md` when it changes durable architecture.

Before sign-off, rebuild the full migration chain in a fresh disposable
database, compare the recreated schema with the intended schema, test relevant
ownership boundaries, run JSKIT Doctor, and run the project verifier.
