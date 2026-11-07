<!-- Generated from `packages/agent-docs/site/guide/framework/data-access.md`. -->

# Data access

Read this before writing code that reads or writes a database table, with or
without screens. [Typed features](typed-features.md) covers how
the code around it is shaped; this page covers how it reaches the data.

## The resource is the only door

Every table has exactly one **table resource**. Only the feature that owns the
table reads or writes it, through the resource's handle. Ownership, the row
policy, validation, ownership stamping, audits and change events run only on
that path. Knex reaches the table past all of them, and putting it in a file
named "repository" protects nothing.

Bad: a repository raised a version counter on a record id it was handed, with
no workspace predicate, so one workspace could change another workspace's
booking.

Good: the owner's repository calls `bookings.patch(id, { version }, options)`,
which changes the row only when the caller's scope owns it.

## Words

| Word | Meaning |
| --- | --- |
| table resource | The one description of one table: fields and their columns, ownership, relationships, search and lock version. `defineTableResource()`, shared with the client. |
| owner feature | The feature whose `owns` lists the table resource. It is the only feature that reads or writes the table. |
| handle | What the owner gets for each resource it owns. Every method applies the scope of the call's `options.context`. |
| repository | The owner's module that holds every query, built on its handles. Its methods have domain names. |
| service | Orchestration. It calls its own repository and other features' services or owner APIs, never handles. |
| CRUD contract | The optional HTTP and screen surface on a table resource: `defineCrudContract()`. |
| API contract | HTTP operations that are not a table: `defineApiContract()`. |
| ownership | Who owns a row: `public`, `workspace`, `user`, `workspace_user`, or `workspace_or_shared` (a workspace's own rows, or rows shared with every workspace when the owner is empty). |
| row policy | A server-only rule narrowing which rows a context sees, applied to every statement, joins, includes and locks included. |
| scoped query | The read-only Knex builder `scopedQuery()` returns, with ownership and the row policy already applied. |
| system scope | The context of work across every workspace and user, declared by a feature with its reason. |
| record | What a handle answers: `{ id, ...fields }`, relationships as ids, included records nested. |

## Layer 1: the table resource

Every table your app owns has one table resource. The feature that owns the
table lists it in `owns`, and only that feature's setup receives its handle.
Every read and write goes through the handle: `query` for one page, `queryAll`
for every matching row, `get`, `create`, `patch` and `delete` for one record,
and `aggregate` for totals. On every statement the handle adds the ownership
predicate and the row policy, validates what you write and stamps the workspace
or user on new rows. Pass the call's `options` (its context and transaction)
to every handle call; a call without a context throws instead of guessing.

```js
// shared/receivalResource.js: the table's facts, shared with the client
const receivalResource = defineTableResource({
  name: "receivals",
  tableName: "receivals",
  ownership: "workspace",
  schema: {
    status: { type: "string", required: true, search: true },
    arrivedAt: { type: "dateTime", nullable: true }
  }
});

// server/ReceivalsFeature.js: the owner
const ReceivalsFeature = defineFeature({
  id: "receivals",
  owns: [receivalResource, { resource: receivalNoteResource, rowPolicy: authorOrManager }],
  provides: { receivals: "receivals" },
  setup: ({ resources }) => ({ receivals: createReceivalsService(createReceivalsRepository(resources)) })
});

// server/receivalsRepository.js: every query, by domain name
function createReceivalsRepository({ receivals }) {
  return Object.freeze({
    withTransaction: receivals.withTransaction,
    listOpen: (page, options) => receivals.query({ filters: { status: "open" }, page }, options),
    markArrived: (id, arrivedAt, options) => receivals.patch(id, { status: "arrived", arrivedAt }, options)
  });
}
```

You never write `where workspace_id = ?`, so you cannot forget it. The row
policy and write hooks go in the `owns` entry on the server, never in the
shared definition, which ships to the browser. A row policy reads the owner's
other tables through `ownTable(name)`, a read-only subquery, never by table
name. Another feature's contribution to a row policy can only narrow it.

## Layer 2: the CRUD surface

When people list, view, create, edit or delete the rows over HTTP, add a CRUD
contract to the same table resource. It says which operations exist and which
fields each one takes and returns; `defineCrudFeature` builds the standard
repository, service, actions, routes and screens from it. A table without
screens skips this layer and still uses Layer 1. A table never gets a second
resource for its CRUD. [CRUD operations](crud-operations.md)
covers this layer in depth.

```js
const receivalCrud = defineCrudContract(receivalResource, {
  apiAccess: "authenticated",
  operations: ["list", "view", "create", "patch"],
  fields: { arrivedAt: { output: "optional" } }
});
```

## Layer 3: many rows at once

When one action creates, changes or deletes many rows, use the handle's
many-row operations: `createMany`, `patchMany`, `patchWhereIds`, `patchWhere`,
`deleteMany` and `deleteWhere`. Each checks every row against the resource
first, reads which of the rows the caller may touch, then writes each chunk
with one statement, in one transaction. Audits and change events run once for
the batch, so the statements are the same for 10 rows as for 200.

Bad: a batch intake patched each record through the resource: 705 statements
for 10 records, 11,915 for 200. Written with `patchMany`, it sends the same
number at both sizes.

An upsert (`createMany(rows, { onConflict })`) on an owned table names the
ownership field among its conflict keys, or it throws: otherwise it could
update or hide another workspace's row. `merge` is refused under a row policy;
use `ignore`, then `patchMany`.

## Layer 4: locks

When two requests could change the same rows at once (allocating stock,
numbering documents, moving items into a batch), lock the rows first, inside
the transaction: `lock(id)`, `lockMany(ids)` or `lockWhere(filters)`. The
handle reads which of those rows the caller may see and locks exactly those,
in id order, so nobody locks another workspace's rows. A worker taking the
next job uses `claim`, which skips rows another worker holds. Take locks in
the same order everywhere, parents before children, or two transactions can
wait on each other.

## Layer 5: reports the resource cannot express

Some reads are reports, not records: totals by status and month, the newest
row per group, distinct active days. Try `aggregate` (counts, sums, buckets by
day, week, month or year) and an include with `strategy: "window"` (newest per
group) first. When neither can express it, the owner's repository builds it
from `scopedQuery()`, the table's builder with ownership and the row policy
already applied:

```js
// Knex: report - the days each member was active, counted per member
activeDays(memberIds, options) {
  return visits.scopedQuery(options)
    .select(visits.column("memberId", "memberId"))
    .countDistinct({ days: visits.raw("DATE(??)", [visits.column("visitedAt")]) })
    .whereIn(visits.column("memberId"), memberIds)
    .groupBy(visits.column("memberId"));
}
```

- Each report is one named repository method under `// Knex: <kind> - <reason>`.
  The kinds are a closed list: `totals`, `report`, `newest-per-group`,
  `subquery`, `hot-path` (with its JSKIT ticket: `// Knex: hot-path #123 -
  <reason>`) and `runtime-tables`.
- `column()` names columns; `raw` takes one expression as a string literal,
  with its values as bindings.
- The builder only reads. Writes use Layers 1, 3 and 4, which JSKIT writes
  once, set-based.
- Give each report a scope test and a flat-query test (see [Tests](#tests)).

## Reads shaped for the screen

- A list reads one page with `query`; it needs `page.size`.
- Related rows come by id list (`filters: { id: ids }`) or `include`, grouped
  in memory. Never a query per row.
- `queryAll` reads every matching row. Use it for id lists, one parent's rows
  and jobs; in a request it throws past the request row limit.

Bad: a list read 100-row pages in a loop for each of 40 related sets.

## Background work

Work over the whole population runs as a background job, never inside one
person's request. Its feature declares why with `systemScope`, and its setup
receives `systemContext(reason)`, which names its reason at every call:

```js
const SettlementFeature = defineFeature({
  id: "leagues.settlement",
  owns: [cohortResource, memberResource],
  systemScope: "settle finished weekly leagues for every user",
  setup: ({ resources, systemContext }) => ({ settlement: createSettlement({ resources, systemContext }) })
});
```

- Prefer `systemContext(reason).forWorkspace(id)` or `.forUser(id)`: the work
  for each workspace or user is then scoped as usual.
- A job loops over units of work, one transaction each, never over rows.
- A request uses its own context. The only exception is a console report
  behind a console permission, with bounded output.
- `jskit check` lists every system scope and every `systemContext` call with
  its reason.

Bad: a job read every record of every workspace inside a request path, every
hour.

## Transactions

Open a transaction with the repository's `withTransaction(options, work)` and
pass the `txOptions` it gives `work` to every call inside. Never read the
transaction out of `options` by hand. Inside an open transaction it joins it;
otherwise it opens one, retries the whole work on a deadlock, and runs events
and other after-effects after commit.

```js
const allocate = (input, options) => repository.withTransaction(options, async (txOptions) => {
  const invoices = await repository.lockOpenInvoices(input.invoiceIds, txOptions);
  return repository.recordAllocations(allocationsFor(invoices, input.amount), txOptions);
});
```

## Tables you don't own

Ask the owner: its service, or for a JSKIT table its owner API, with the same
`options`. JSKIT's packages expose their tables this way: users
(`users.profiles`, `users.settings`), workspaces (`workspaces`,
`workspaces.memberships`), local sign-in (`auth.local.accounts`,
`auth.local.sessions`, `auth.local.recovery`) and the console
(`console.settings`). A realtime audience reaches its users the same way: its
`audienceUsers({ event, options })` asks the owners and answers user ids.

Bad: an app wrote sign-in sessions and memberships with Knex; the framework's
own checks and audits never ran.

## Check and judge

Before calling data work done, check:

- Do its statements grow with its rows? `expectFlatQueries` answers.
- Does any request read a whole table?
- Does every read and write path have a scope test?
- Does each `// Knex:` method fit its kind, or could `aggregate` or an include
  do it?
- Do write hooks and side effects stay in the caller's scope?
- Do locks take rows in the same order everywhere?

Clearly broken: a test that seeds for minutes, a request that takes seconds, a
statement count in the thousands.

## Tests

Each data path gets two one-line tests on the real test database:

```js
test("allocation stays in its workspace", () => expectScoped({ environment: process.env, handles: [invoices, payments], systemContext, owners: [workspaceA, workspaceB], seed: seedInvoices, run: (owner) => billing.allocate(input, owner) }));
test("allocation is flat", () => expectFlatQueries({ environment: process.env, seed: seedInvoices, run: (seeded) => billing.allocate(inputFor(seeded), seeded.options) }));
```

`expectFlatQueries` (from `@jskit-ai/resource-runtime/test`) seeds each size,
counts the statements the path sends, and fails when a larger size sends more,
with the counts and the statements repeated most; the later chunks a many-row
write reports are allowed. `expectScoped` seeds a second owner, runs the path as
the first, and fails when the result holds the second owner's rows or the path
changed them. A data test never skips: without `TEST_DB_NAME` it fails
(`requireTestDatabase(process.env)`).

## Hard rules

These are always wrong, and lint reports them as errors in server and shared
code. Tests, migrations and seeds are outside them.

### Lint rules

| Rule | Reports | Section |
| --- | --- | --- |
| `jskit/no-direct-knex` | a table reached by name with Knex, a `.knex` read, a transaction opened by hand | [The resource is the only door](#the-resource-is-the-only-door) |
| `jskit/no-transaction-reader` | `options.trx`, `trx \|\| knex`, a `trx = knex` default, `trx` destructured from options | [Transactions](#transactions) |
| `jskit/no-hand-scope` | a hand-written `where` on `workspace_id` or `workspaceId` | [Layer 1: the table resource](#layer-1-the-table-resource) |
| `jskit/sql-literal` | raw SQL built from strings or templates instead of one literal with bindings | [Layer 5: reports the resource cannot express](#layer-5-reports-the-resource-cannot-express) |
| `jskit/knex-reason` | a `scopedQuery()` report outside a named repository method under `// Knex: <kind> - <reason>` | [Layer 5: reports the resource cannot express](#layer-5-reports-the-resource-cannot-express) |

### Exceptions

A file whose job is data access itself (a database runtime, test-database
setup, a health check, session cleanup, platform provisioning) may opt out of
`jskit/no-direct-knex` and `jskit/no-transaction-reader` as a whole, with one
line per rule before its first line of code:

```js
// readable-check: allow no-direct-knex - infrastructure: the test databases' snapshot and restore
```

`jskit check` lists every such file for review. The other three rules take no
exception. `jskit check` also fails a table with two table resources, and a
system scope or `systemContext` call without a reason.
