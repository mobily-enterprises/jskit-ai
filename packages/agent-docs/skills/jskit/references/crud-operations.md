# CRUD operations

Read this completely before database, schema, CRUD, repository, or persistence
work.

## Establish the contract

Take the database adapter, surface, access, and ownership from the request and
app authority. Inspect only a generator whose exact lane or option values are
missing, or whose supplied command failed:

```bash
npx --no-install jskit show crud-server-generator --details
npx --no-install jskit show crud-ui-generator --details
```

Never run these merely to reconfirm caller-supplied facts.

Normal app-owned CRUD tables use one non-null integer primary key. Every
foreign key is single-column and targets that key; multi-column unique indexes
are business constraints, never relationship targets. Only direct
`workspace_id` and `user_id` columns are generated ownership. Names such as
`recipient_user_id` are domain relationships. Match the ownership filter to
the reserved columns exactly, and test allowed plus cross-workspace cases.
Stop before generation when these contracts disagree.

## Conventional one-table CRUD

Create the validated table first in a fresh disposable development database;
the server generator reads its live shape:

```bash
npx --no-install jskit generate crud-server-generator scaffold \
  --namespace <resource> \
  --surface <surface> \
  --ownership-filter <public|user|workspace|workspace_user> \
  --access <public|authenticated> \
  --table-name <table>
```

Use public access only on a non-workspace surface with public ownership. A
workspace CRUD chooses exactly one of `--grant-role <role>` or
`--no-role-grant`; never invent a role. `--internal` keeps the generated
repository/service/resource ownership chain but suppresses public HTTP routes.

Run `npm install`, then generate UI from the exact shared resource:

```bash
npx --no-install jskit generate crud-ui-generator crud \
  <pages-root>/<plural-route> \
  --resource-file packages/<namespace>/src/shared/<singular>Resource.js \
  --parent-title contextual
```

The target is relative to `src/pages/`, starts with the selected surface's
nonempty configured `pagesRoot` (for example `home/books`), and has no leading
slash. For a surface deliberately configured with an empty root, use
only the plural route. Use the exact singular resource filename emitted by the server generator; do not guess it.

That resource is canonical. Do not hand-build routes, validators, HTTP helpers,
or UI before it exists. Prefer `useCrudListScreen()`, `useCrudViewScreen()`, and
`useCrudAddEditScreen()` for routed screens; the corresponding `useCrud*()`
composables for routed behavior; and `useList()`, `useView()`, `useAddEdit()`,
`useCommand()`, or `useEndpointResource()` for non-standard contracts. Standard
CRUD derives JSON:API transport from the resource—never use raw `fetch()`.

## Generated record deletion

Request ordinary routed deletion explicitly:

```bash
npx --no-install jskit generate crud-ui-generator crud notes \
  --resource-file packages/notes/src/shared/noteResource.js \
  --id-param noteId \
  --display-fields title,body \
  --parent-title contextual \
  --navigation-role primary \
  --delete-confirmation
```

`--delete-confirmation` requires generated list and view pages and a shared
resource with a `DELETE` operation. It supports a custom `--id-param` and fails
clearly when the contract is unsupported. The view uses the public
`CrudViewScreen` `actions` slot, `CrudDeleteAction`, and
`useCrudDeleteAction()`. The shared component owns the Cancel/Delete dialog;
`useCommand()` owns pending/error state and the resource request; success
invalidates the CRUD list and navigates there. Import the public client runtime
from `@jskit-ai/http-web`; do not inspect package-private code, add a page
transport, or use raw `fetch()`.

## Strict temporal values

With `json-rest-schema` 1.0.17, temporal resource values are strings:

- `date`: `YYYY-MM-DD`
- `time`: offset-free `HH:MM[:SS[.fraction]]`
- `dateTime`: RFC 3339 with seconds and `Z` or a numeric offset

Do not pass JavaScript `Date` objects through resource validation; convert at
the boundary (normally `toISOString()` for `dateTime`). Numeric epochs use
`epochMilliseconds` or `epochSeconds`. Honor `temporalPrecision` without
silently truncating fractions. Generated CRUD
serializes supported database temporal output; custom repositories must return
strict strings and write ISO/RFC 3339 strings themselves.

## Migration ownership

Never compete with or alter a generator-owned baseline migration. Later schema
changes are immutable additive migrations owned by the app-local package:

```bash
npx --no-install jskit create migration --package <package-id> --id <id>
npx --no-install jskit migrations sync
npm run db:migrate
```

An exceptional persistence lane requires explicit developer approval recorded
in `.jskit/WORKBOARD.md` and `.jskit/table-ownership.json`, plus
`.jskit/APP_BLUEPRINT.md` when architectural. Before sign-off, rebuild from
zero in a fresh disposable database, compare schema, test ownership boundaries,
run Doctor, and run the verifier.
