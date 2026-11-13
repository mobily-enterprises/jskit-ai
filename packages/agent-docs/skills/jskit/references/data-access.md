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

## The handle's calls

One table, one table resource, one owner feature. The owner reaches its table
through its handle's calls, and every call takes the call's `options` last:

| Call | Does |
| --- | --- |
| `query({ filters, sort, page, include }, options)` | one page: `{ records, page }` |
| `queryAll({ filters, sort, include, take }, options)` | every matching row, or the first `take`, for jobs, id lists and one parent's rows |
| `queryPages({ filters, sort, include }, options)` | every matching row, a page at a time, for work over many rows |
| `get(id, params, options)` | one record |
| `aggregate({ measures, groupBy, filters, sort, page }, options)` | totals, grouped by fields or date buckets |
| `create(data, options)`, `findOrCreate({ id, ...data }, options)` | one record; a keyed one, created once |
| `patch(id, changes, options)`, `delete(id, options)` | one record |
| `createMany(rows, options)` | many records, or an upsert with `onConflict` |
| `patchMany(rows, options)` | many records, each with its own changes |
| `patchWhere(filters, changes, options)`, `deleteWhere(filters, options)` | every matching row |
| `lock(id, txOptions)`, `lockMany(ids, txOptions)`, `lockWhere(filters, txOptions)` | rows locked until the transaction ends |
| `lockOrCreate({ id, ...initial }, options, work)` | a keyed record locked, created first when missing, for `work` |
| `claim({ filters, sort, take }, txOptions)` | the next rows no other worker holds |
| `withTransaction(options, work)` | one transaction; `work` gets its `txOptions` |
| `changeHorizon(options)` | PostgreSQL's snapshot horizon, where a read of what changed since starts ([What changed since](#what-changed-since)) |
| `scopedQuery(params, options)` | a read-only builder for a report ([Layer 5](#layer-5-reports-the-resource-cannot-express)) |

```js
// How many invoices of each status the workspace issued each month, and their total.
function totalsByMonth(options) {
  return invoices.aggregate({
    groupBy: ["status", { field: "issuedAt", bucket: "month", as: "month" }],
    measures: { invoices: { count: "*" }, amount: { sum: "amount" } },
    sort: ["month"]
  }, options);
}
```

A grouped `aggregate` answers its groups from one statement, at most
`pageLimits().request` of them (the resource's `queryMaxLimit`). When there
are more it throws a 400 coded `RESOURCE_GROUP_LIMIT` instead of answering
part of them. Narrow the filters, or read the groups in pages, `page: { size,
number }` with `number` from 1. A page answers as a `query` page does, `{ rows,
page: { size, number, hasMore, next } }`, never a bare array that could pass
for every group: read the next while `page.hasMore`.
Page numbers are offsets, so read every page before work that changes what
the filters match.

## Words

| Word | Meaning |
| --- | --- |
| table resource | The one description of one table: fields and their columns, ownership, relationships, search and lock version. `defineTableResource()`, shared with the client. |
| owner feature | The feature whose `owns` lists the table resource. It is the only feature that reads or writes the table. |
| handle | What the owner gets for each resource it owns. Every method applies the scope of the call's `options.context`. |
| repository | The owner's module that holds every query, built on its handles. Its methods have domain names. A plain CRUD feature's repository is its table's handle itself. |
| service | Orchestration. It calls repositories (its own, or another feature's through that feature's capability: an owner API, or a CRUD feature's `repository`) and other features' services. It never builds a query (no Knex, no `scopedQuery`) and never reaches another feature's table any other way. |
| owner API | The capability through which a table's owner lets other features read and write its records, such as `users.profiles`. |
| CRUD contract | The optional HTTP and screen surface on a table resource: `defineCrudContract()`. |
| CRUD feature | The feature `defineCrudFeature()` builds from a CRUD contract: its repository, service, actions, routes and screens. |
| ownership | Who owns a row, required in every table resource: `public`, `workspace`, `user`, `workspace_user`, `workspace_or_shared` (a workspace's own rows, or rows shared with every workspace when the owner is empty), or `system` (rows of no workspace or user, which only the owning feature's system context reaches). |
| row policy | A server-only rule narrowing which rows a context sees, applied to every statement, joins, includes and locks included. |
| scoped query | The read-only Knex builder `scopedQuery()` returns, with ownership and the row policy already applied. |
| system scope | Why a feature works across every workspace and user, declared with `systemScope`. |
| system context | The context of that work, from `systemContext(reason)`; `forWorkspace`, `forUser` and `forWorkspaceUser` narrow it. |
| `txOptions` | What `withTransaction(options, work)` hands `work`: only the call's context and its transaction, `{ context, trx }`, passed to every call inside. |
| record | What a handle answers: `{ id, ...fields }`, relationships as ids, included records nested. |

## Layer 1: the table resource

Every table your app owns has one table resource. The feature that owns the
table lists it in `owns`, and only that feature's setup receives its handle.
Every read and write goes through the handle. On every statement the handle
adds the ownership predicate and the row policy, validates what you write and
stamps the workspace or user on new rows. A table whose schema stores
`createdAt` and `updatedAt` as `dateTime` fields gets them stamped by every
write: both on a create (`createMany` too), `updatedAt` on every change
(`patch`, `patchMany`, `patchWhere`, an upsert merge, which keeps the stored
`createdAt`). The stamps replace what any other caller sends, and a CRUD
contract offers them as output only; only a system context (an import, a
migration, a seed) sets its own. Pass the call's `options` (its context and
transaction) to every handle call; a call without a context throws instead of
guessing.

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

/**
 * server/receivalsRepository.js: every query, by domain name.
 * @param {{ receivals: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} handles
 */
function createReceivalsRepository({ receivals }) {
  /**
   * One page of the open receivals.
   * @param {{ size: number, after?: string }} page
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   */
  function listOpen(page, options) {
    return receivals.query({ filters: { status: "open" }, page }, options);
  }

  /**
   * @param {string} id
   * @param {string} arrivedAt
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   */
  function markArrived(id, arrivedAt, options) {
    return receivals.patch(id, { status: "arrived", arrivedAt }, options);
  }

  return Object.freeze({
    withTransaction: receivals.withTransaction,
    listOpen,
    markArrived
  });
}
```

A field's type says what its column holds, not the column's SQL type. A
whole-number column that is not an id (a counter, a byte count, a position),
BIGINT included, is `type: "integer"`. Every handle read answers it as a
number on MySQL, MariaDB and PostgreSQL alike, although both drivers read
BIGINT as text. A column that holds another row's id is `type: "id"` and
reads as text, as ids do. Past 2^53 − 1 a JavaScript number cannot hold a
whole number exactly, so json-rest-api answers those digits as text rather
than a rounded number. A value that can grow that large gets a decimal field
(`precision` and `scale`), whose digits stay text.

A `type: "blob"` field holds bytes the process reads and writes whole, so it
names `maxBytes`, the most bytes a value holds, and its column holds that much
too: MySQL's and MariaDB's `BLOB` holds 64 KiB and `MEDIUMBLOB` 16 MiB, while
PostgreSQL's `bytea` and SQLite's `BLOB` hold more than any limit you would
name. A blob takes no `search`, `indexed`, `unique`, `sortable`, `defaultTo` or
`belongsTo`. A write takes a Buffer or a Uint8Array of at most `maxBytes`, or
null, and refuses anything else with a validation error on the field (422)
before any statement, a transaction's or a lock's included. A read leaves a
blob out unless its `fields` names it, and answers it as a Buffer, holding at
most 16 MiB of the blobs it names, or one record's: `get(id, { fields:
["image"] }, options)` and `lock()` read one record's; a page of `query()` and
the ids of `lockMany()` are refused past the records whose `maxBytes` fit 16
MiB, and each page of `queryPages()` holds no more. `queryAll()`, `lockWhere()`
and `claim()` read every matching row at once, so they refuse to name a blob,
and no read names an included table's blob, since an include holds any number
of records: read it through that table's handle. A join source carries no
blob. JSON holds no binary, so a JSON:API read and a CRUD contract refuse a
blob, and a route of its own serves one as the response body. A file people upload (a photo, a
document) goes to storage through `runtime.uploads` and the table keeps its
key; a blob is for the few bytes the record itself needs, such as a thumbnail
or a signature.

```js
const signatureResource = defineTableResource({
  name: "signatures",
  tableName: "signatures",
  ownership: "workspace",
  schema: {
    signedBy: { type: "string", required: true },
    // MEDIUMBLOB on MySQL and MariaDB
    image: { type: "blob", maxBytes: 256 * 1024, required: true }
  }
});

// One signature's image, read where a route answers it.
const imageOf = async (id, options) => (await signatures.get(id, { fields: ["image"] }, options)).image;
```

A package whose features own tables or declare `systemScope` lists
`runtime.resources` in its descriptor's `capabilities.requires`, or boot
refuses it; the feature never requires it itself, since it receives its
handles.

Reads take `(params, options)` and writes `(data, options)`: `get(id, {},
options)`. A call's settings ride in its options, added on the call they are
for and spread from the options the method received: `{ ...options, missing:
"skip" }`, `{ ...options, returning: "id" }`. A method passes on only the
options it received, never a setting it added for one of its own calls, and
another table gets only `{ context, trx }`: `passedOn(options)` from
`@jskit-ai/resource-runtime/server`. An owner API, called with another
feature's options, hands each of its calls `passedOn(options)` plus the
settings that call needs, never the caller's options whole. `withTransaction`
hands its work only the context and the transaction, and so does a handle to
its hooks and its own nested calls.

`txOptions` is `{ context, trx }` and nothing else: every other key of the
method's `options`, the application's own included (a flag that skips an
email, a `limit`, a per-request cache), is gone inside the work. Read what the
work needs from `options` itself, never from `txOptions`. A method that wraps
a write on its own table in `withTransaction` passes that write `{ ...options,
...txOptions }`, or the caller's `returning`, `missing` or `format` never
reaches it and the method answers something its caller did not ask for.
Another table's call still gets `txOptions`:

```js
const addLines = (rows, options) => lines.withTransaction(options, async (txOptions) => {
  const added = await lines.createMany(rows, { ...options, ...txOptions });
  await orders.patch(rows[0].orderId, { linesChangedAt: new Date() }, txOptions);
  return added;
});
```

A filter key is one of the resource's `search: true` fields or a
`searchSchema` entry. `id` is every handle's own filter (a resource never
declares an `id` search entry) and takes one id or a list; an empty list
matches no row. Another list of values needs an entry with `filterOperator:
"in"`. A `null` value matches the rows where the field is null: `filters: {
archivedAt: null }`.

A filter on another table's field (`searchSchema: { supplierName: { type:
"string", actualField: "suppliers.name" } }`) needs that field declared
`indexed: true` on its own table resource, with a database index on its column,
even when the join is on the other table's id; `own()` refuses it at startup
otherwise, naming both. That `indexed: true` is the other table's owner letting
filters search the field. The filter reads that table as the table's own read
in the caller's scope: its ownership, its owner's row policy and the policies
contributed to it decide which of its rows can match, in `query`, `queryAll`,
`queryPages` and `aggregate` alike, and each row matches once, through a
has-many path too (suppliers filtered by their items' names). `own()` also
refuses two filters no scope guards: one that reads a `system` table from a
table that is not `system`, since a request would read it, and one on a field
the other table hides, which would tell a caller which rows hold a value it
may not read. For either, the other table's owner answers the ids it matches
through its owner API, and the filter takes the list: `filters: { supplierIds }`.

A filter that asks whether a row has, or lacks, another owner's rows
(projects with an open task, projects with no task) reads that owner's join
source. The `owns` entry's `searchSchema` names each join source by an alias,
with a function answering its owner from the feature's `requires` or its own
handles (`owned`), and `applyFilter` gets `joinSource(alias)`: that owner's
`{ query, column }` for the caller's scope, as a report's join source
([Layer 5](#layer-5-reports-the-resource-cannot-express)), which it ties to
the row with `whereColumn` inside `whereExists` or `whereNotExists`:

```js
// the projects feature's owns entry; the feature requires the tasks owner as `tasks`
{
  resource: projectResource,
  searchSchema: {
    hasOpenTask: {
      type: "boolean",
      joinSources: { k: ({ requires }) => requires.tasks },
      applyFilter(query, wanted, { column, joinSource }) {
        const task = joinSource("k");
        const openTasks = task.query
          .select(task.column("id"))
          .whereColumn(task.column("projectId"), column("id"))
          .where(task.column("status"), "open");
        if (wanted) {
          query.whereExists(openTasks);
        } else {
          query.whereNotExists(openTasks);
        }
      }
    }
  }
}
```

The handle builds the join sources a read's filters use just before the read,
in the call's own context and transaction, so `query`, `queryAll`,
`queryPages`, `aggregate` and `joinSource` take the filter in their one
statement, and the other owner's ownership, row policy and hidden fields
decide which of its rows count (`column()` refuses a hidden field). A filter
that prefers one match and falls back on another when no row of the table has
the first (the projects named like the term, or, when none is, those with a
task in that status) names the feature's own handle for its own table,
`({ owned }) => owned.projects`. Only a read through a handle builds join
sources. `own()` refuses, at startup, `joinSources` that is not a record of
functions under aliases, such a filter with `oneOf` or without `applyFilter`,
and `joinSources` in the table resource's own `searchSchema`, which names no
feature to answer it.

An app switches to such a filter where a search resolves another owner's
matches first: a repository that reads the other owner's ids (an id report on
its `scopedQuery()`, or that owner's `queryAll` matched in memory) and then
filters `id` by the list, or a filter that was a `whereRaw` with `EXISTS
(SELECT ... FROM ...)`, which `jskit/sql-literal` refuses. The filter moves
into the `owns` entry with the other owner as a join source, the code that
resolved ids goes, and the read is one statement however many rows match,
where the id list grew with the matches.

A table keyed by a `uuid` or `string` primary key takes its ids as text; an
`owns` entry's `normalizeId` is only for an id written some other way.

A handle finds every row by one `id`. A table whose rows another key
identifies (a workspace and a day, or one row per user keyed by the user's id)
still gets an integer `id` primary key, and keeps that key as a unique index
on exactly the columns its upsert names, the ownership column among them. The
code reads by the key with a filter and writes by it with an upsert,
`onConflict: { keys: ["workspaceId", "day"] }`
([Layer 3](#layer-3-many-rows-at-once)). The [port
guide](existing-application-migration.md#moving-hand-written-sql-behind-resources)
has the migration for a table that exists already.

A route that reads or writes without an action (a provider's callback, a
download it streams) takes its options from `await request.callOptions()`: the
context the same request's action would get, its user, workspace and route
scope resolved by the same contributors. No action's permission runs, so the
route's own `auth` and `permission` are its gate. Never build a request's
context by hand.

A `workspace_or_shared` table's shared rows (no workspace) belong to every
workspace, so no request or job writes one: a create stamps the caller's
workspace, a patch or delete of a shared row is refused, and many-row writes
and locks leave shared rows out. When a request may change one (a permission
says so, or the row is the person's own), the owner reads the row in the
request's own context, which proves the caller reaches it, decides in code
whether this caller may change it, and only then writes it in a system
context, `systemContext(reason)` itself (one `forUser` or its kin derived is
not a system context), naming the empty owner: `create({ ...fields,
workspaceId: null }, …)`, or `patchWhere({ id: [id], workspaceId: null },
changes, …)` and `deleteWhere` with the same filters, which never reach a
workspace's row. `{ ...txOptions, context: systemContext(reason) }` joins
the request's transaction.

A read answers every field unless `fields` names the ones it needs (a
belongs-to field by its own key, such as `customerId`, or its relationship);
the locks (`lock`, `lockMany`, `lockWhere` and `claim`) take it in their
options, `{ ...txOptions, fields }`.
Each belongs-to field a read answers costs a check that its related record is
visible, so a hot path names its fields. A collection relation with
`hydrateOnList: false` or `hydrateOnView: false` loads its rows on that kind of
read only when the read includes it.

`foreignKeys` declares the table's real database foreign keys, in json-rest-api's
shape: `foreignKeys: [{ columns: ["customerId"], referencedTableName: "customers" }]`,
`columns` naming schema fields and `referencedColumns` the other table's columns
when they are not its `id`. json-rest-api relies on a declared key to skip work,
so a declaration the database lacks changes results: before any test runs,
`jskit test --databases` compares every declaration with the test database's keys,
fails on one the database lacks and lists the keys of your tables that nothing
declares.

A `hidden: true` field (an ownership id, a bearer token, a storage key) never
reaches a request: no CRUD route or JSON:API document (`format: "jsonapi"`)
carries it, even when `fields` names it. The owner's own code reads one by
naming it in a handle read's `fields`, `get(id, { fields: ["publicToken"] },
options)` or `{ ...txOptions, fields }` for a lock, which costs one more
statement per 1,000 records, scoped as the read is; a read without `fields`
never answers it. It may be an id, string, integer, number or boolean, and
naming any other kind refuses the read. The repository a CRUD feature gives
other features, and its own actions, refuses any call whose `fields` names a
hidden field, whatever the method (`decorateRepository`'s included), and any
`scopedQuery()` or answered builder other than a `joinSource()`'s (either can
select every column), and every method it holds answers without the hidden
fields of the tables its owner owns, unless the call runs in a system context.
It tells hidden fields by name, so a feature whose tables hide a field in one
and show it in another fails to start: hide it in both, or rename one. So the
owner checks a token in a method `decorateRepository` adds, with the handle it
receives, and answers only the outcome. Work in another feature that needs the
value itself (a key it signs with, an address it sends to) calls a method the
owner's `decorateService` adds: that receives the repository before the guard,
so it reads the field, named in `fields`, in the caller's own context, with no
system context. A test of such a path asserts the value the other feature uses,
not only that the call succeeded: a hidden field left out of a record reads as
`undefined`, not as an error. Never unhide a field to read it, and
never read it with `scopedQuery`.

`create` and `patch` answer the written record by default, read back through
the row policy. Server code that does not use it passes `returning: "id"` or
`"none"`, which skips that read; `delete` answers the id. One rule covers a
record that is missing or outside the caller's scope: `get`, `patch`, `delete`
and `lock` throw json-rest-api's not-found error (a 404), and with
`missing: "skip"` they answer `null` instead, without failing the caller's
transaction. A row keyed by an id the code computes (a fingerprint, a
conversation id) is read or created once with `findOrCreate({ id,
...attributes }, options)`, outside the transaction that then locks it: inside
one, losing the race to create it fails the whole transaction. Compute such an
id from the owner too (the workspace or user id in the fingerprint): an id
another scope's row holds answers a missing record. That answer still says the
id is taken, so `findOrCreate` and `lockOrCreate` take only ids the server
computes or generates, never an id a request supplies.

A write that the caller's row policy then hides fails, because its read-back
finds nothing. The `create` or `patch` answers json-rest-api's 404
(`REST_API_RESOURCE`, "Resource not found") and its transaction rolls back. A
staff member who sees only the bookings they run cannot book a colleague this
way. Decide which way the rule goes. Either the policy lets the writer see
what they may write, or the action refuses the write before it runs, with a
403 or 422 that says why.

You never write `where workspace_id = ?`, so you cannot forget it. The row
policy and write hooks go in the `owns` entry on the server, never in the
shared definition, which ships to the browser. Another feature's contribution
to a row policy can only narrow it. A row policy adds one predicate correlated
with the row being read, on indexed columns, and reads the owner's other
tables through `ownTable(name)`, a read-only subquery, never by table name. It
never loads everything the subject was ever linked to into an `IN` list, and
never calls another owner's check once per item: it runs on every read, write
read-back and lookup, so every request pays what it costs. A policy is told
who the call runs for as `caller`: `{ kind: "user", userId }` for a signed-in
request, `{ kind: "anonymous" }` for one by no one, and `{ kind: "system" }` or
`{ kind: "job" }` (a context `forWorkspace` and its kin derived), each with its
`reason`, for background work. A job names a user only as `actorId`, the
person it works for ([below](#background-work)), so never read a missing actor
as an anonymous request. The owner's policy also receives the capabilities its
feature requires (and its optional ones), by local name, as `requires`, the
same ones its setup receives: a policy that needs another feature's answer
declares that feature's capability in `requires` and reads `requires.<name>`.
It runs on every read, so what it asks there must be cheap.

```js
// good: one predicate on the row being read
function noticeVisibilityPolicy({ query, caller, column, value, ownTable }) {
  if (caller.kind !== "user") {
    return caller.kind !== "anonymous";
  }
  query.where(column("recipientId"), value("recipientId", caller.userId)).whereExists(
    ownTable("sources").select(1).whereColumn("sources.id", column("sourceId")).where("sources.status", "published")
  );
  return true;
}

// bad: every source the recipient was ever notified about, checked one by one
async function noticeVisibilityPolicy({ query, caller, context, column, value }) {
  const readable = [];
  for (const sourceId of await noticeHistory.listSourceIds(caller.userId)) {
    if (await sources.canRead(sourceId, context)) readable.push(sourceId);
  }
  query.whereIn(column("sourceId"), readable.map((id) => value("sourceId", id)));
  return true;
}
```

A policy narrows with `where` calls only: `where`, `andWhere`, `orWhere` and
their kin (`whereIn`, `whereExists`, `whereNot`, `orWhereNull`...). Its calls
run inside one parenthesised `where` group, where Knex compiles predicates and
drops a join without a word, which would leave the policy hiding nothing; any
other call (`join`, `leftJoin`, `select`) throws a TypeError naming the
feature, the policy and the table. To narrow through another table, tie a
subquery to the row with `whereExists`: over `ownTable(name)`, which may join
the owner's other tables, or over another owner's join source. A policy is told
the call's `options`, `{ context, trx }` as the caller passed them, and passes
them on unchanged to `joinSource({ alias }, options)`, so the join source reads
in the caller's scope and transaction; never build them by hand.

```js
// good: a member of the document's team sees it, through the teams owner's join source
async function teamDocumentsPolicy({ query, caller, column, options, requires }) {
  if (caller.kind !== "user") {
    return caller.kind !== "anonymous";
  }
  const member = await requires.teams.joinSource({ alias: "tm" }, options);
  query.whereExists(
    member.query.select(1).whereColumn(member.column("teamId"), column("teamId")).where(member.column("userId"), caller.userId)
  );
  return true;
}

// bad: a join inside the policy, which Knex would drop from the where group; it throws
function teamDocumentsPolicy({ query, caller, column }) {
  query.join("team_members as tm", "tm.team_id", column("teamId")).where("tm.user_id", caller.userId);
  return true;
}
```

A rule that depends on the caller's role reads `context.permissions` with
`hasPermission(context.permissions, "bookings.view-all")` from
`@jskit-ai/kernel/shared/support`, never with `includes()`. A role may hold
`*` (an owner does) or `bookings.*`, and `includes()` misses both, so the
owner would see only the rows a narrower rule leaves. No action requires such a
permission, so list it in `roleCatalog.customPermissions`, or the server refuses
to start outside production (see Workspace tenancy → Role permissions).

```js
import { hasPermission } from "@jskit-ai/kernel/shared/support";

// good: staff see the bookings they run; bookings.view-all, the owner's * included, sees them all
function staffSeeTheirOwnBookings({ query, caller, context, column, value }) {
  if (caller.kind !== "user") {
    return caller.kind !== "anonymous";
  }
  if (hasPermission(context.permissions, "bookings.view-all")) {
    return true;
  }
  query.where(column("staffUserId"), value("staffUserId", caller.userId));
  return true;
}

// bad: an owner holding "*" sees only the bookings they run
if (context.permissions.includes("bookings.view-all")) return true;
```

A policy trusts `caller`. In a workspace request it also trusts what the
server resolved from the route's workspace slug and the caller's membership
before any handle ran:
- `context.workspace.id`;
- `context.membership.roleSid`;
- `context.permissions`, the role's permissions in that workspace.

On a surface whose access policy sets `requireWorkspaceMembership: false`, a
caller who is not a member has `context.membership` null and
`context.permissions` empty. Never decide on a value from the request's input.

A row policy hides a row everywhere, also as the target of a visible record's
link: an order whose supplier the reader cannot see reads `supplierId: null`.
A form that saves the order back sends that null, and the write keeps the
stored link: a null for a link whose target exists but is hidden from the
writer counts as unchanged. Send that null, never the hidden id: a write naming
a target the writer cannot see is refused as a missing target, since accepting
the right hidden id would tell the writer which record is linked. The link is
still unreadable to that reader, so a row policy says who may see a row at all;
narrowing what one screen lists is a filter on that screen's read.

```js
// bad: a row policy to list only the suppliers a user added; every order whose
// supplier someone else added now reads supplierId: null for that user
owns: [{ resource: supplierResource, rowPolicy: addedByActor }]

// good: the screen's read filters; orders keep their suppliers
function listAddedByMe(params, options) {
  return suppliers.query({ ...params, filters: { ...params.filters, addedBy: resolveActorId(options.context) } }, options);
}
```

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
  namespace: "receivals",
  apiAccess: "authenticated",
  operations: ["list", "view", "create", "patch"],
  fields: {
    status: { output: "required", create: "required", patch: "optional" },
    arrivedAt: { output: "optional" }
  }
});
```

A contract shows and accepts only the fields it names, and so does an included
record: it shows its id, its relation's `labelKey`, and only what the including
contract lists, a record it links to only when the list names that
relationship, at any depth. Another table's contract never shapes it, since
that contract may be served to another surface or behind another permission:

```js
fields: {
  ownerId: { output: { required: false, includeFields: ["displayName"] } },
  // ?include=pet,pet.breed shows the pet's name and its breed's name
  petId: { output: { required: false, includeFields: ["name", { breed: ["name"] }] } }
}
```
An included record's link is listed by its relationship, never as a field:
`{ location: [] }` answers the pet's location id, with its fields inside the
list when the include reaches it. A belongs-to field named by its key
(`"locationId"`) or its relationship (`"location"`) is a relationship in the
document, never an attribute, so it would never show; the app refuses it at
boot, naming the link form.
A read narrows an included record with `fields[<its JSON:API type>]`, at any
depth, and never widens what the include shows:
`?include=pet,pet.breed&fields[breeds]=name`. A type the includes reach below
their first level takes only the fields and links they list of it there; any
other field, and a type no include reaches, answer 400 naming what the read
takes.
A `decorateService` that also needs the record it wrote (for an audit or a
history row) reads it from its own answer, `simplifyJsonApiResult(answer)`
from `@jskit-ai/http-runtime/shared`, never with a second read; a relationship
whose field key is not its name plus `Id` passes
`{ lookupFieldMap: { owner: "ownerUserId" } }`.
A second surface on the same table (a customer's view beside the staff's) is
a second CRUD contract on the same resource, never a second resource, with
its own namespace. One plain feature owns the table and provides its handle.
Each surface is a `defineCrudFeature` that serves its contract through that
handle with `ownerRepository`. A CRUD feature that owns the table provides
`{ repository, crud, service }` rather than a handle, so it cannot be another
one's `ownerRepository`.

```js
const ServicesFeature = defineFeature({
  id: "app.services",
  owns: [serviceResource],
  provides: { services: "app.services" },
  setup: ({ resources }) => ({ services: resources.services })
});
const ServiceAdminFeature = defineCrudFeature({
  crud: serviceAdminCrud,
  surface: "admin",
  ownerRepository: "app.services",
  scope: WORKSPACE_CRUD_SCOPE,
  relativePath: "/services"
});
const ServiceCatalogFeature = defineCrudFeature({
  crud: serviceCatalogCrud,
  surface: "app",
  ownerRepository: "app.services",
  scope: WORKSPACE_CRUD_SCOPE,
  relativePath: "/service-catalog"
});
```

`WORKSPACE_CRUD_SCOPE` is from
`@jskit-ai/workspaces-core/server/support/workspaceCrud`; the two contracts'
namespaces differ because `crud.contracts` refuses two contracts under one
namespace. A field
fragment several resources spread into their schemas carries only the field:
each contract that shows it states its operations in its own `fields`.

## Layer 3: many rows at once

When one action creates, changes or deletes many rows, use the handle's
many-row operations: `createMany`, `patchMany`, `patchWhere` and `deleteWhere`.
Every filter takes `id`, one id or a list, so `patchWhere({ id: ids },
changes, options)` and `deleteWhere({ id: ids }, options)` change a known
list. Each checks every row against the resource first, reads which of the
rows the caller may touch, then writes each chunk with one statement, in one
transaction. A chunk is 500 rows unless the call passes `chunkSize`, which is
at least 100: a smaller chunk would send a statement every few rows, as a loop
does, and is refused before any statement. Audits and change events run once
for the batch, so the statements are the same for 10 rows as for 200. `patchWhere` and
`deleteWhere` check the scope and filters on each row once they hold its lock,
so a row gone meanwhile, or changed so that it no longer matches, is skipped,
and they take no `missing`. That makes them a compare-and-set on their filters
on every database: of two writers whose filters both matched a row (open to
booked), only one writes it, and the other's answer says so
(`returning: "ids"` lists only the rows it wrote). The one that waited for the
other's lock leaves the row out; SQLite gets there by failing the second writer
with `SQLITE_BUSY`, and MariaDB with `innodb_snapshot_isolation` fails the
waiter with errno 1020 ("Record has changed since last read"), which a write
that owns its transaction runs again. For one row,
`patch(id, changes, { ...options, onlyIf: { status: "open" } })` does the same.
A filter on another table (a search field whose `actualField` reaches a
related table, or one that reads a join source) is refused on MySQL and
MariaDB (`RestApiValidationError`, rule `selection_cross_table`), even when it
matches no row; `lockWhere` and `claim` refuse it the same way. A search entry's own
`applyFilter` that reads another table through a subquery is not detected, and
is no compare-and-set there either. Filter on the row's own columns instead, for example
on the link after locking its targets with `lockMany` in the same transaction
(Layer 4), or move the value onto the row itself for `onlyIf`, or use a
`claim`. A many-row write answers
nothing unless `returning` asks: `"ids"`, `"records"`, or `"count"`, which
reads nothing back.

Bad: a batch intake patched each record through the resource: 705 statements
for 10 records, 11,915 for 200. Written with `patchMany`, it sends the same
number at both sizes.

An upsert (`createMany(rows, { ...options, onConflict })`) on an owned table
names the ownership field among its conflict keys, or it throws: otherwise it
could update or hide another workspace's row. `merge` is refused under a row
policy; use `ignore`, then `patchMany`. A table with no owners and no row
policy, keyed by a natural id such as an email, may key the upsert on the id
alone: `onConflict: { keys: ["id"], action: "merge" }`, with an id on every
row, creates the record or replaces the fields given in one statement. Of two
upserts at once the later stays, so a counter that must count both is created
plainly and its duplicate retried instead. Inserting and catching the
duplicate works only outside a transaction: inside one, the failed insert
fails the whole transaction, so use an upsert there.

A transaction whose insert loses a race for a unique key (another request with
the same idempotency key committed first) runs once more:
`retryLostInsertRace(options, () => repository.withTransaction(options, work))`
from `@jskit-ai/database-runtime/shared`. The database reports the duplicate
only once the winner has committed, so the second run's lookup by the key
finds the winner's row. A second duplicate is final, and inside a caller's
transaction nothing runs again: the caller's transaction has failed, and the
caller's own retry runs the whole of it. Never write this retry by hand.

```js
// A repeated payment request answers the first one's record.
const recordPayment = (input, options) => retryLostInsertRace(options, () => payments.withTransaction(options, async (txOptions) => {
  const [paid] = await payments.queryAll({ filters: { requestKey: input.requestKey } }, txOptions);
  return paid ?? payments.create(input, txOptions);
}));
```

## Layer 4: locks

When two requests could change the same rows at once (allocating stock,
numbering documents, moving items into a batch), lock the rows first, inside
the transaction: `lock(id, txOptions)`, `lockMany(ids, txOptions)` or
`lockWhere(filters, txOptions)`. The handle locks only rows the caller may
see, in id order, so nobody locks another workspace's rows: a missing or
hidden id throws not-found, as for `get`, or with `missing: "skip"` is left
out. A check-then-write that must not race (is the drier empty? then load it)
locks the record first, so another lock or write of it waits until the
transaction ends. Locks cover existing rows only: number with a unique index
or a counter row taken with `lock(id)`. Every lock needs a transaction; SQLite
runs one transaction at a time, so there is no row lock to take. Take locks in
one order on every path, a parent before its children.

A lock answers the rows it locks, with the fields `fields` names. Its
`include` names belongs-to relationships (`include: ["customer"]`, or
`"batch.yard"` a level further): after its own rows, the lock locks the
records they name through each related table's own handle (its scope, its row
policy, its hidden fields), in id order, each related table once however many
rows name it, and nests them as a read's include does; a link to a record the
caller may not see reads as in a read, its belongs-to field null. Those are locks too, so on MySQL and MariaDB
they find a record committed after the transaction's first plain read, which a
plain read misses. They come after the rows, a child before the parent it
names, so a path that locks the parent first and then its children (to add one)
takes the other order: the database ends a deadlock between the two by failing
one transaction, which `withTransaction` runs again, and a path that runs
often keeps one order on both sides. A collection (`include: ["lines"]`) is
refused before any statement: lock a parent's children with their own
table's `lockWhere` in the same transaction.

Every other read after the lock is a plain read. On PostgreSQL every statement
sees what had committed when it began, so that read is current. On MySQL and
MariaDB a plain read inside a transaction sees the snapshot of the
transaction's first plain read, and a lock that waited does not move it. So
take the lock before any plain read in the transaction: the reads after it then
see what the lock's previous holder committed. A related row the work decides
on (is this seat already booked?) is locked itself, through the lock's
`include` or a lock of its own, or read after a lock that every writer of it
takes first.

```js
// good: the lock is the transaction's first read, so the bookings read after it are current
const reserve = (seatId, options) => seats.withTransaction(options, async (txOptions) => {
  await seats.lock(seatId, { ...txOptions, fields: ["status"] });
  const [taken] = await bookings.queryAll({ filters: { seatIds: [seatId] }, take: 1 }, txOptions);
  return taken ? null : bookings.create({ seatId }, { ...txOptions, returning: "id" });
});

// bad: the read before the lock fixed the snapshot, so a booking committed while the lock waited is missed
const [booked] = await bookings.queryAll({ filters: { seatIds: [seatId] }, take: 1 }, txOptions);
await seats.lock(seatId, txOptions);
```

On MySQL and MariaDB a locking read locks every row it examines, so two rules
apply there. Lock ids taken from your own scoped reads, never a list straight
from a request: every id listed is locked, a hidden one too, before it is left
out. And `lockWhere` needs an index that starts with the ownership columns (on
a table with no owners, with a column the filters compare); without one it
refuses with `RestApiBulkWriteUnsupportedError` naming the index to add in a
migration.

A worker taking the next job uses `claim({ filters, sort, take }, txOptions)`,
which skips rows another worker holds. A record that serializes work on a key
and may not exist yet (an account's balance, a connection to a provider), on a
table with no owners, takes `lockOrCreate({ id, ...initial }, options, work)`:
it locks the record, creating it from the row first when it is missing, and
runs `work(record, txOptions)` in the same transaction, so failed work leaves
no record behind. On its own it runs work once, so work may call a provider:
two first uses of one id at once can collide on the insert, and the loser runs
again before its work starts.

Every lock takes `FOR UPDATE`, as `patchWhere` does for the rows it selects,
which also keeps out another transaction's insert of a row that references the
locked one (a foreign key's check). Where work locks a parent only to change
its own fields while children may be added meanwhile (a balance others post
entries to), pass `lockMode: "noKeyUpdate"` to `lock`, `lockMany`,
`lockWhere`, `claim`, `lockOrCreate` or `patchWhere`: on PostgreSQL it
is `FOR NO KEY UPDATE`, which still keeps every other lock and write of the row
out but lets those inserts through; MySQL, MariaDB and SQLite lock as for the
default `"update"`. Any other value throws a `TypeError` before anything runs.

A check that only reads rows, and needs them unchanged until the transaction
ends while other checks read them at once (is the membership still active
while this document is filed under it?), takes a shared lock: `lockMode:
"share"` on `lock`, `lockMany` or `lockWhere`, and so on an owner API that
passes its options on, such as `workspaces.lock(workspaceId, { ...txOptions,
lockMode: "share" })` or
`workspaces.memberships.lockByWorkspaceIdAndUserId(workspaceId, userId, {
...txOptions, lockMode: "share" })`. It is `FOR SHARE` on PostgreSQL and `LOCK
IN SHARE MODE` on MySQL and MariaDB: other reads, shared locks and inserts of
rows that reference the locked ones go on, and an update, a delete or an
exclusive lock of them waits until the transaction ends; SQLite still runs one
transaction at a time. Never write a row the transaction holds shared: two
transactions that each hold it shared and then write it wait for each other,
and the database fails one as a deadlock. Lock a row the work will write with
the default `"update"` from the start. `claim`, `patchWhere` and
`lockOrCreate` refuse `"share"` with a `TypeError`, since they take or write
their rows.

```js
// good: concurrent filings check the membership at once; a change to it waits until this commits
const file = (input, options) => documents.withTransaction(options, async (txOptions) => {
  const membership = await memberships.lock(input.membershipId, { ...txOptions, lockMode: "share", fields: ["status"] });
  if (membership.status !== "active") {
    throw new ConflictError("documents.membershipInactive");
  }
  return documents.create(input, txOptions);
});

// bad: the transaction holds the membership shared, then writes it; two such filings deadlock
await memberships.patch(input.membershipId, { lastFiledAt: new Date() }, txOptions);
```

Locks stay on the owner's handle and its owner API. A `scopedQuery()` or
`joinSource()` builder takes no lock, and a row policy is not told a read's
lock mode: it says which rows a caller may see, the same for every read. Rows
of several owners are never locked in one statement over a join, which on
MySQL and MariaDB locks every joined row the read examines: lock each owner's
rows with its own `lock`, `lockMany` or `lockWhere`, the owners in one fixed
order on every path (a parent's owner before its children's), so two
transactions never take them in opposite orders.

A record that a person edits from a form it read earlier carries a version
number: the table resource names it with `lockVersionField`, an integer field
over a non-null integer column with `defaultTo: 0`.
`patch(id, changes, { ...options, lockVersion })` then locks the row, applies
`changes` only while it still holds that version, and advances it. A record
whose version moved on rejects with a 409 coded
`crud.document.lockVersionConflict` ("This record changed. Reload and try
again.") and nothing is written; a missing or hidden record follows the
missing-row rule. The changes leave the version field out. Every update
advances the version, a plain `patch`, `patchMany`, `patchWhere` or upsert
merge too, so a form that read version 3 and saves after a background job's
plain patch of the same record (now version 4) gets the 409 and reloads, even
though the job changed other fields. `patch(id, changes, { ...options, onlyIf:
{ status: "open" } })` is the same check on stored values, answering `null`
when they differ.

## Layer 5: reports the resource cannot express

Some reads are reports, not records: totals by status and month, the newest
row per group, distinct active days. Try `aggregate` (counts, sums, buckets by
day, week, month or year) and an include with `strategy: "window"` (newest per
group) first. A window include is declared on the table resource's
relationship, never in the query, and read with `include: ["snapshots"]`:

```js
relationships: {
  snapshots: { type: "hasMany", target: "snapshots", foreignKey: "booking_id", include: { strategy: "window", limit: 1, orderBy: ["-revision"] } }
}
```

When neither can express it, the owner's repository builds it from
`scopedQuery()`, the table's builder with ownership and the row policy already
applied:

```js
// Knex: report - the days each member was active, counted per member
async function activeDays(memberIds, options) {
  const { query } = await visits.scopedQuery({}, options);
  return query
    .select({ memberId: visits.column("memberId") })
    .countDistinct({ days: visits.raw("DATE(??)", [visits.column("visitedAt")]) })
    .whereIn(visits.column("memberId"), memberIds)
    .groupBy(visits.column("memberId"));
}
```

- Each report is one named method in its owner's repository file
  (`*Repository.js`, `repository.js`, or a file under `repositories/`;
  `jskit/knex-reason` refuses `scopedQuery()` anywhere else), under
  `// Knex: <kind> - <reason>`. The kinds:
  - `totals`: sums or counts `aggregate` cannot group;
  - `report`: rows shaped across tables;
  - `newest-per-group`: one row per group, such as each customer's latest
    visit;
  - `subquery`: a scoped set another query joins;
  - `hot-path`: a measured path the handle makes too slow, with its JSKIT
    ticket (`// Knex: hot-path #123 - <reason>`);
  - `runtime-tables`: tables people define while the app runs, which no table
    resource in the code describes.
- `column()` names columns; `raw` takes one expression as a string literal,
  with its values as bindings.
- Its rows are the driver's, with no field types applied: a BIGINT column
  (ids and counters alike) and a `COUNT` read as text on MySQL and MariaDB
  (the runtime's `bigNumberStrings`) and on PostgreSQL (int8). The method
  turns the counts and totals it answers into numbers, such as `Number(days)`
  for `activeDays` above.
- The builder only reads, and only its own table is scoped. A `.join()` or
  `.from()` of a table by name, or a table named inside `raw()`, reads that
  table's rows past its owner and row policy, and so does a subquery callback
  (`whereIn("id", (sub) => sub.from(...))`), whose builder is Knex's own. Nothing
  at run time stops it: `jskit/no-direct-knex` and `jskit/sql-literal` flag it
  (a name as text, an alias object such as `{ p: "projects" }`, a variable
  whose name says table or name, a const holding one, either branch of a `?:`
  or `??`, any `fromRaw()` or `joinRaw()`, and in a subquery callback any
  variable but a scoped subquery or one destructured from a call, such as
  `const { query } = await lots.scopedQuery(...)`), and `expectScoped` catches it
  only when the test seeds another owner's rows the join matches. Join another
  table only as that table's scoped subquery.
- When a report needs another owner's rows side by side, it joins that
  table's join source in one statement. `joinSource({ alias, filters },
  options)` on the owner's handle, or on the repository a CRUD feature gives
  other features, answers `{ query, column }`: the caller's scoped rows under
  that alias (ownership, the row policy and the filters applied) with the
  columns a read answers and the ownership fields (`workspaceId`, `userId`),
  hidden or not, as join keys; never another hidden column, and never a blob,
  so a report's `select("k.*")` holds no unbounded bytes. `column(field)`
  names each under the alias. A report on the owner's own `scopedQuery()`
  names the columns it selects, never a blob's. The builder comes wrapped, since a builder is
  thenable and an async function would run it. The report shapes it (select,
  group), names it with `.as()` and joins it, so every owner's scope and row
  policy stay applied. The report lives with the main table's owner, or in a
  feature that requires both. Never hand-build a join source on `scopedQuery()`: its
  builder carries every column, so a CRUD feature's repository refuses
  `scopedQuery()`, and any method answering a builder other than a
  `joinSource()`'s, outside a system context. A report that needs another
  owner's hidden value asks that owner for a method answering what it needs.

  ```js
  // Knex: report - open tasks and billed totals per project, joined on billing's scoped invoices
  async function projectSummary(options) {
    const source = await billing.joinSource({ alias: "i" }, options);
    const billed = source.query
      .select({ projectId: source.column("projectId") })
      .sum({ billed: source.column("amount") })
      .groupBy(source.column("projectId"))
      .as("b");
    const { query } = await tasks.scopedQuery({ alias: "t" }, options);
    const projectId = tasks.column("projectId", "t");
    return query
      .leftJoin(billed, "b.projectId", projectId)
      .select({ projectId })
      .count({ open: tasks.column("id", "t") })
      .max({ billed: "b.billed" })
      .groupBy(projectId);
  }
  ```

- A report that asks which of its rows have, or lack, another owner's rows
  puts that owner's join source in `whereExists` or `whereNotExists`, tied to
  its own row with `whereColumn`; one that counts them joins the source grouped,
  as `projectSummary` does. Rows matched by a related row's value ("items
  whose supplier is named Acme") need no report: a cross-table search filter
  answers them in a plain read ([Layer 1](#layer-1-the-table-resource)). Nor
  does a question that only narrows a plain read's rows (has an open task, has
  no task): a search filter that reads the other owner's join source answers
  it in that read, with its page, sort and includes as usual (Layer 1).

  ```js
  // Knex: report - the caller's projects with no task the caller sees
  async function idleProjects(options) {
    const task = await tasks.joinSource({ alias: "k" }, options);
    const { query } = await projects.scopedQuery({ alias: "p" }, options);
    const projectId = projects.column("id", "p");
    return query
      .whereNotExists(task.query.select(task.column("id")).whereColumn(task.column("projectId"), projectId))
      .select({ id: projectId, name: projects.column("name", "p") });
  }
  ```

- A report in a feature that owns none of its tables (a console's, over
  several owners) roots at the main owner's `joinSource()` instead of a
  `scopedQuery()`, and ties the other owners' join sources to it the same way,
  in one statement, every owner's scope and row policy applied.

  ```js
  // Knex: report - the caller's projects with no task the caller sees, for a console that owns neither table
  async function idleProjects(options) {
    const project = await projects.joinSource({ alias: "p" }, options);
    const task = await tasks.joinSource({ alias: "k" }, options);
    return project.query
      .whereNotExists(task.query.select(task.column("id")).whereColumn(task.column("projectId"), project.column("id")))
      .select({ name: project.column("name") });
  }
  ```

- An app switches a report it kept as a raw-SQL exception (another owner's
  table joined by name, or a subquery in `raw()`, in a file under an
  infrastructure exception, see [Exceptions](#exceptions)) to these: the
  report's feature requires each owner whose rows it reads, puts each owner's
  join source where the table stood (`whereExists`, `whereNotExists`, or
  joined grouped for counts and sums), roots at its own table's
  `scopedQuery()` or at the main owner's `joinSource()`, and the file drops
  its `readable-check: allow` lines and its `jskit-data-access.json` entry.
  When an owner is a JSKIT package, its owner API answers `joinSource`
  ([Tables you don't own](#tables-you-dont-own)).
- When each owner can answer on its own (keys in, grouped totals out), the
  report is a feature of its own that calls each owner's method and merges the
  answers in memory: one statement per owner, never a call per row.
- Give each report a scope test and a flat-query test (see [Tests](#tests)).

## Reads shaped for the screen

- A list reads one page with `query`; it needs `page.size`, at most the
  resource's `queryMaxLimit`. A scrolling list passes the previous page's
  `page.next` as `page.after`; numbered pages, or restoring a known page, pass
  `page.number` (from 1) and answer `page: { size, number, hasMore, next }`.
  `page.number` reads with OFFSET, which slows as the rows grow, so anything
  that grows pages with `page.after`. Each page is one statement, with no
  count: never walk pages to reach one.
- A screen list never uses `queryAll`, and neither does a picker: it reads
  one page searched on the server as the person types (`q`), narrowed in the
  query by what it depends on (the parent record, `active`), and reads its
  selected values past that page by id. Reading every row for a dropdown, or
  narrowing a page in code, either grows with the table or misses rows.
- Related rows come by id list (`filters: { id: ids }`, or an `in` filter on
  another field) or `include`, grouped in memory. Never a query per row, however
  the loop is spelled (`for`, `map` with `Promise.all`, a helper called per
  item).
- `queryAll` reads every matching row, in cursor pages that each start after
  the sort values of the page before, so no row is skipped or read twice
  unless a write moves a row's sort value (the id, by default) past the page
  while the read runs. Use it for id lists, one parent's rows and jobs: a read its callers
  treat as complete, which a `query` would silently cut at one page. In a
  request it stops past the request row limit (`pageLimits().requestRows`,
  10,000 rows) with a 400 coded `RESOURCE_ROW_LIMIT`, and never answers part
  of the rows. A job reads without that limit and holds every row in memory.
  `queryAll({ ..., take: 500 })` answers only the first 500 rows in its sort
  order and reads no row past them, the last page no larger than the rows still
  wanted. `take` is then the read's bound, so a request may name more than the
  request row limit and never gets `RESOURCE_ROW_LIMIT`: name the bound the
  work can hold, never one from the request unchecked.
- Work over many rows reads `queryPages` and handles one page at a time:
  `for await (const records of handle.queryPages(params, options))`. Each
  page is one statement of up to `pageLimits().server` rows (fewer when its
  fields name blobs, so it holds at most 16 MiB of them), plus the reads of
  its includes and of the hidden fields it names, and starts after the sort
  values of the last row of the page before. So the work may change what the
  filters match as it goes, and no row still to come is skipped or read twice,
  as long as it leaves the sort fields' values alone (the id, by default): a
  row whose sort value moves past the page is read again or not at all. In a
  request it throws at the same row limit, before the page that passes it.
  `expectFlatQueries` allows each later page's own statements, as it allows
  a many-row write's later chunks; work the path does for each page counts.

```js
// good: one page of invoices, then all of that page's lines in one read
const { records, page: next } = await invoices.query({ sort: ["-issuedAt"], page }, options);
const lines = await invoiceLines.queryAll({ filters: { invoiceIds: records.map((invoice) => invoice.id) } }, options);
const linesByInvoice = Map.groupBy(lines, (line) => line.invoiceId);

// bad: one more read, and its row policy, for every invoice
for (const invoice of records) {
  invoice.lines = await invoiceLines.queryAll({ filters: { invoiceIds: [invoice.id] } }, options);
}

// good: a delivery job reads every active subscriber
const subscribers = await subscriptions.queryAll({ filters: { newsletterId, status: "active" } }, options);

// good: a job over a table of any size marks each page as it reads it
for await (const records of reminders.queryPages({ filters: { status: "due" } }, txOptions)) {
  await reminders.patchWhere({ id: records.map((reminder) => reminder.id) }, { status: "sent" }, txOptions);
}

// bad: the first page only, whatever its size
const { records: firstPage } = await subscriptions.query({ filters: { newsletterId, status: "active" }, page: { size: 20 } }, options);
```

Bad: a list read 100-row pages in a loop for each of 40 related sets.

## Narrow in the query

A read asks the store for exactly the rows the code uses. The filter, sort,
limit, existence check and count go in the read, never in code over the rows
it answered: a read of every row then narrowed is slow, and a page or a `take`
then narrowed is also wrong, since the row wanted can sit past it.

- Filter with the resource's searchSchema: a field
  (`filters: { status: "open" }`), an id list (`filters: { id: ids }`, or an
  `in` filter on another field), or `q` for typed text, whose `oneOf` names the
  fields it searches.
- One row: a unique filter with `take: 1` or `page: { size: 1 }`, which also
  answers whether one exists. A count: `aggregate()`.
- Never filter, find, slice or count the rows a read answered, nor skip some
  in a loop. Mapping them and grouping them by a key (`Map.groupBy`) narrow
  nothing, and neither does code that needs every row it read: rows handed on
  whole (returned, passed, stored, mapped or walked in full) with a subset
  derived beside them, and rows matched against other items in a loop or a
  callback (an in-memory join, one read instead of one per item).
- A lookup field's picker and a list's Search box send what the person types
  as `q` to the server, which searches every row; `useList` does with
  `search: { enabled: true }`. The table resource defines `searchSchema.q`.
  Never search the page a list loaded in the browser: it misses every row past
  it.
- A CRUD list refuses a query key it does not take with a 400
  (`crud.query.undeclaredKeys`). A list filter is declared in the feature's
  `listFilterQueryValidator` and the resource's searchSchema. The person sees
  only that nothing was loaded and to reload or tell support, with no Retry;
  the keys refused, the keys the list takes and how to declare one are in the
  server log, as a warning, and in the error's `details`.
- Prove a capped read with a test that seeds past the cap and makes the row
  the cap leaves out (the oldest, for a newest-first read) the one that
  matches: the read that asks for it finds it; a read narrowed in code does
  not.

```js
// good: the store answers one module's sections
const { records } = await sections.query({ filters: { moduleId }, sort: ["-createdAt"], page: { size: 50 } }, options);

// bad: the newest 200 sections of every module, then one module's kept in code
const { records: recent } = await sections.query({ sort: ["-createdAt"], page: { size: 200 } }, options);
const moduleSections = recent.filter((section) => section.moduleId === moduleId);

// good: one row says who holds a unique username
const [holder] = await profiles.queryAll({ filters: { usernames: [username] }, take: 1 }, options);
```

`jskit/narrow-in-query` reports `.filter()`, `.find()`, `.some()`,
`.every()`, `.slice()`, a lone `.length` and a loop that skips rows with
`continue` over the rows a read answered in the same function, unless the
code also uses those rows whole, runs the narrowing once per item of
something else, read at most one row, or slices a read that asked for one row
more than it keeps (`limit(size + 1)`) to learn whether more follow.
`jskit/search-on-server` reports a client search over a list's loaded items.
`jskit check` fails a lookup field or a CRUD list screen whose app table
resource has no `searchSchema.q`, on the resource or its owns entry
(`data/search-q`). Other code that needs every row a read answers says why on
the line above the read or the narrowing:

```js
// readable-check: allow narrow-in-query - every row: a conversation holds at most keep + 1 summaries, since each save deletes the older ones
```

## What changed since

A page that catches up on a chat, a watch that acts on changes and a sync to
another system each read what changed since they last read. "Past the highest
id seen" misses a row whose id was taken before its transaction committed, and
every change to an older row; "`updatedAt` after the last read" misses a
transaction that committed after a later one. On PostgreSQL a change stamp and
the change horizon miss neither:

- The table stamps each row with the transaction that last wrote it, an `xid8`
  column a trigger sets on every insert and update, whatever the write sent,
  with an index that starts with the ownership columns:

  ```js
  // migrations/20261108120000_messages_changed.cjs
  exports.up = async function up(knex) {
    await knex.raw("alter table messages add column changed xid8 not null default pg_current_xact_id()");
    await knex.raw("create function messages_changed() returns trigger language plpgsql as $$ begin new.changed := pg_current_xact_id(); return new; end $$");
    await knex.raw("create trigger messages_changed before insert or update on messages for each row execute function messages_changed()");
    await knex.raw("create index messages_changed_ix on messages (workspace_id, changed)");
  };
  ```
- The table resource reads it as an `xid8` field, which nothing writes, and
  filters on it:

  ```js
  schema: { /* ... */ changed: { type: "xid8", nullable: true } },
  searchSchema: {
    changedSince: { type: "xid8", actualField: "changed", filterOperator: ">=" },
    changedBefore: { type: "xid8", actualField: "changed", filterOperator: "<" }
  }
  ```
- The reader takes `changeHorizon(options)` before it reads and answers it as
  the next cursor. Every transaction below the horizon had finished, so the
  next read, `changedSince: cursor`, finds everything this read could not see.
  A row can come twice, so the reader merges by id. A job that keeps its cursor
  in a row reads the window `{ changedSince: cursor, changedBefore: horizon }`
  and stores the horizon as the new cursor in the same transaction.

```js
async function catchUp(conversationId, since, options) {
  const cursor = await messages.changeHorizon(options);
  const changed = await messages.queryAll({ filters: { conversationId, changedSince: since } }, options);
  return { messages: changed, cursor };
}
```

The horizon is the server's: a long transaction anywhere holds it back, so a
read repeats more rows, never misses one. MySQL, MariaDB and SQLite stamp no
row with its transaction: `changeHorizon` throws `UnsupportedDatabaseError`
there, and an `xid8` field is refused. A reader there takes the rows to handle
with `claim()`, marking each done in the same transaction.

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

- Prefer `systemContext(reason).forWorkspace(id)`, `.forUser(id)` or
  `.forWorkspaceUser(workspaceId, userId)`: each workspace or user is then one
  unit of work, scoped as usual, in a transaction of its own. An event it
  publishes carries that workspace's or user's scope, as a request there would,
  so it reaches that audience, never everyone. An action it runs with
  `actions.execute({ actionId, input, context })` keeps the context's kind:
  inside it, a handle call still reads as the system context or job.
- Work a job does for one person (a request it carries out later) passes
  `{ actorId }` last: `forWorkspace(id, { actorId: requestedBy })`. It says
  whom the work is for and never sets the scope, which stays the workspace or
  user the job was derived for, and it signs no one in: `resolveActorId` and
  every `authenticated` check still see no one. Audit fields read it with
  `resolveAuditActorId(context)`. A row policy is told it as `caller.actorId`,
  and one that holds people to their own rows reads it as it reads a
  request's `caller.userId`, so a job for a person sees what that person may
  see, and a job for no one its whole scope. Work on one person's rows only
  takes their scope (`forUser`, `forWorkspaceUser`) or filters its reads.
- A job finds its units with an `aggregate` grouped by the ownership field,
  which a system context may group by (and count distinct) even when the table
  hides it, then runs each unit scoped to it. It reads the units in pages, all
  of them before the first runs, since settling a unit changes what the
  filters match. A request's aggregate still refuses a hidden field:

  ```js
  async function settleDue(options) {
    const size = cohorts.pageLimits().request;
    const due = [];
    for (let number = 1; number; ) {
      const { rows, page } = await cohorts.aggregate({ measures: { cohorts: { count: "id" } }, groupBy: ["workspaceId"], filters: { status: "finished" }, page: { size, number } }, options);
      due.push(...rows);
      number = page.next;
    }
    for (const { workspaceId } of due) {
      await settleWorkspace({ context: systemContext("settle finished weekly leagues for every user").forWorkspace(workspaceId) });
    }
  }
  ```
- A job that must learn each row's owner across workspaces names the hidden
  ownership field in its read's `fields`, `queryAll({ filters, fields:
  ["workspaceId", "email"] }, { context })`, as a system context may do through
  another feature's CRUD repository too (see [Layer
  1](#layer-1-the-table-resource)). Never unhide it for the job.
- A request uses its own context. The exceptions are a console report
  behind a console permission, with bounded output, and the write of a shared
  row it has proved it reaches ([Layer 1](#layer-1-the-table-resource)).
- `jskit check` lists every system scope and every `systemContext` call with
  its reason, read from the string literal at the call: a reason kept in a
  constant reads as none.
- A system context comes only from `systemScope`, and a context's scope only
  from the request or from `forWorkspace`, `forUser` and `forWorkspaceUser`:
  lint refuses `createSystemContext` and hand-written `scopeValues`, and a
  context naming two workspaces or two users throws.
- A table only the feature's own background work reads and writes, whose rows
  belong to no workspace or user (an agent's runs, a server's leases, a queue
  keyed by something other than an owner), takes ownership `system`. Every call
  then needs the owner's `systemContext(reason)`: a request's context, a
  `forWorkspace`, `forUser` or `forWorkspaceUser` job and no context at all
  throw `SystemContextRequiredError` before any statement, since on such a
  table they would reach every workspace's rows. Requests
  reach the rows only through the owner's own methods, which decide what each
  caller may see, and `defineCrudFeature` refuses a `system` table. A table
  whose rows do belong to a workspace or user names that ownership instead.
- A job that runs on a schedule is a feature whose `boot()` starts a timer and
  whose `shutdown()` stops it; JSKIT ships no scheduler. See
  [typed features, Owned state](typed-features.md#owned-state).
  Every server runs the timer, so a run takes its rows with `claim()`.

Bad: a job read every record of every workspace inside a request path, every
hour.

## Transactions

Open a transaction with the repository's `withTransaction(options, work)` and
pass the `txOptions` it gives `work` to every call inside, spread over the
method's own `options` for the write the caller's settings are for. Never read the
transaction out of `options` by hand. A handle refuses every other
transaction, a raw Knex one or a savepoint, for reads as for writes. Inside an
open transaction it joins it; otherwise it opens one and runs events and other
after-effects after commit. Any failed write inside it fails the whole
transaction.

A deadlock victim's transaction (MySQL and MariaDB errno 1213, PostgreSQL
`40P01`), and one MariaDB fails as "Record has changed since last read" (errno
1020, with `innodb_snapshot_isolation` on), runs its whole work again, up to
three more times, so the work must
be safe to repeat: an HTTP call or an email goes after commit, or into an
outbox row written inside it. Work that cannot be repeated passes `{ ...options, retry: false }`, and work that must
commit before its caller goes on passes `{ ...options, outermost: true }`.
Work that must commit or roll back with its caller's transaction, and so must
never open one of its own, passes `{ ...options, joinOnly: true }`: called
outside a transaction it throws a TypeError before the work runs. Code never
asks whether it runs in a transaction: `withTransaction` joins the caller's,
`outermost` refuses one, `joinOnly` requires one, and `lock`, `lockMany`,
`lockWhere` and `claim` refuse to run outside one; `lockOrCreate` opens its own
(and retries a lost insert race only then).

```js
// good: both moves land with the caller's transaction, or neither does
async function moveStock(transfer, options) {
  return stock.withTransaction({ ...options, joinOnly: true }, async (txOptions) => {
    await stock.patch(transfer.fromId, { quantity: transfer.fromQuantity }, txOptions);
    await stock.patch(transfer.toId, { quantity: transfer.toQuantity }, txOptions);
  });
}

// bad: asks whether it runs in a transaction by reading it out of options
async function moveStock(transfer, options) {
  if (!options.trx) throw new Error("moveStock runs inside its caller's transaction");
  await stock.patch(transfer.fromId, { quantity: transfer.fromQuantity }, options);
  await stock.patch(transfer.toId, { quantity: transfer.toQuantity }, options);
}
```

When the work throws, the transaction rolls back and the caller gets the
work's own error, with its status and code, reporting `transactionOutcome:
"rolledBack"`, so `retryLostInsertRace` (Layer 3) also runs again work that
turned the duplicate into its own 409. A failed write inside the work, or a failed commit, reaches
the caller as json-rest-api's `RestApiWriteError` with the transaction's
outcome. It carries the failure's own `code` and `status` (a driver's
`ER_CHECKREAD`, a not-found's 404), and `REST_API_WRITE` only when the failure
has no code. Classify an error by its `code` or `status`,
never with `instanceof`: a second copy of a package makes a second class.

A database error never reaches a client. Its message carries the statement
and its values, so JSKIT's HTTP handler and the assistant's stream answer one,
thrown as it is or as a wrapper's cause, with a stand-in
(`hideDatabaseError` in `@jskit-ai/kernel/server/runtime`) and log it in full:
409 `kernel.database.concurrentWrite` when the database refused the transaction for a concurrent one
(a deadlock or lock wait whose retries ran out, a row changed since the
transaction's snapshot, a serialization failure), which the client may send
again, else 500. To give a duplicate key or another database refusal its own
answer, throw an `AppError` (a `ConflictError`) with the driver's error as its
`cause`: an `AppError` keeps its answer whatever it wraps.

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
(`console.settings`). Local sign-in's owner APIs work in its system context,
so `jskit check` wants a reviewed reason for each module that requires one
(see [Hard rules](#hard-rules)). A realtime audience reaches its users the same way: its
`audienceUsers({ event, options })` asks the owners and answers user ids, in the
event's scope: for a customer's or a public surface's event, the workspace the
request resolved, never one its payload names (see [Realtime](/guide/app-extras/realtime)).

Code that names people by id (a conversation's members, a group's
participants) reads them with `users.profiles.listByIds(ids, options)`: every
profile in one call, however many ids, never `query` pages of 100 walked by
hand or one `findById` per person. `users.settings.listByUserIds(ids, options)`
does the same for their settings, and `workspaces.listByIds(ids, options)` for
workspaces. A report that reads people, their settings, workspaces or
memberships beside its own rows joins `joinSource({ alias, filters },
options)` of `users.profiles`, `users.settings`, `workspaces` or
`workspaces.memberships` ([Layer 5](#layer-5-reports-the-resource-cannot-express)).

An app that had a table resource of its own over a JSKIT table (such as
`users`) deletes it: its CRUD contract is built on the package's table resource
(users-core's `userProfileTableResource`) and served through the owner with
`defineCrudFeature({ crud, ownerRepository: "users.profiles" })` (the
`users/user-administration-server` pattern). The app's own facts about a
person (a staff role, a preference) live in the app's own table keyed by the
user id, owned by the app with ownership `user` or `workspace_user`, never as
new columns on `users`.

A surface over a table you don't own that may show only some of its rows (a
people picker limited to those who share a workspace with the caller) asks the
owner for exactly that read, as one owner API method that narrows with one
predicate over the owner's own tables. It never contributes the rule to the
owner's row policy, which narrows every read of the table (sign-in's too), and
never passes an id list of everyone the caller may see: an id list is fine for
the rows one screen shows, not for a rule over thousands of people. An owner
without such a method gets one added at the owner; until then the surface uses
the owner's own listing for that scope, such as
`workspaces.memberships.listActiveByWorkspaceId(workspaceId, options)`, which
reads the members with their users in one statement.

Bad: an app wrote sign-in sessions and memberships with Knex; the framework's
own checks and audits never ran.

## Two features that need each other

When a parent's owner and its children's owners each need the other (the
parent's service reads its children, and a child's write must advance the
parent's version), split what both need into a feature of its own, so
capabilities point one way:

- The parent table's owner keeps the table and provides a small owner API,
  such as `versions.advance(id, txOptions)`, and requires none of the
  children.
- Each child's owner requires that API and calls it in its own write's
  transaction, from its repository's write method. An `owns` entry's
  `afterWrite` hook cannot do it: it is declared with the table, before any
  capability arrives.
- The aggregate that reads or changes them together (the parent with its
  children) is a third feature that requires both.

A version that moves on with no field changed is the parent's
`lockVersionField`: `lockMany(ids, txOptions)` locks the parents, and
`patchMany(ids.map((id) => ({ id })), { ...txOptions, returning: "none" })`
advances each by one, in one statement, whatever the field is called. An
advance is an update, so it stamps the parent's `updatedAt` too: the parent as
a whole changed, and a reader that compares either one sees it. A condition
named with no value, such as `lockVersion: record.lockVersion` on a field
called `version`, is refused (`options.lockVersion is undefined`), never run
without it.

### Capability cycles

A capability cycle is a ring of requires: feature A requires a capability that
feature B provides while B, directly or through others, requires one that A
provides. An `optional` require closes a ring as a required one does. The
kernel sets features up in the order their requires give, so it cannot start a
ring: boot fails before any setup, naming it,
`Provider capability cycle detected: children -> parents -> children.`
`startTestFeatures` orders features the same way, so a feature test meets the
ring before the server does. The same ring between packages, each listing the
other in its `package.json` dependencies (as importing the other's shared
table resource needs), fails as
`Package dependency cycle detected: @local/jobs -> @local/checklists -> @local/jobs`.

Data access makes them easy to write: a parent's owner reads its children
through their owners while each child's owner checks or advances the parent.
Keep every require pointing one way:

- The table nearest the root requires none of the owners below it. It provides
  a small owner API, and the owners below require that.
- Work that reads several owners together (a parent with its children, a
  report across them) is a feature of its own that requires each of them, as
  above and in [Layer 5](#layer-5-reports-the-resource-cannot-express).
- A package imports another package's shared table resource only when that
  package does not depend on it back. When two packages need each other's
  definitions, move those table resources into a package of their own that
  holds only shared definitions and depends on neither.
- Never break a ring with a value handed over later (a setter, a capability
  looked up at call time): a call's destination then depends on what ran
  before. A setter kept until the split carries typed features' `cycle:`
  exception ([Optional tokens](typed-features.md#optional-tokens)).

## Check and judge

Before calling data work done, apply the
[sanity checks](sanity-checks.md#query-counts-and-batches) with
JSKIT's tools: `expectFlatQueries` for statements that grow with rows,
`expectScoped` for every read and write path, and a look at each `// Knex:`
method, which `aggregate` or an include might do instead.

## Tests

Each data path gets two one-line tests on the real test database, with the
helpers from `@jskit-ai/resource-runtime/test`:

```js
import { expectEveryTableOwned, expectFlatQueries, expectScoped, startTestFeatures } from "@jskit-ai/resource-runtime/test";

test("allocation stays in its workspace", () => expectScoped({ environment: process.env, handles: [invoices, payments], systemContext, owners: [workspaceA, workspaceB], seed: seedInvoices, run: (owner) => billing.allocate(input, owner) }));
test("allocation is flat", () => expectFlatQueries({ environment: process.env, knex, seed: seedInvoices, run: (seeded) => billing.allocate(inputFor(seeded), seeded.options) }));
```

`expectFlatQueries` (from `@jskit-ai/resource-runtime/test`) seeds each size,
counts the statements the path sends, and fails when a larger size sends more,
with the counts and the statements repeated most; the later chunks a many-row
write reports, and the statements of each later page `queryPages()` reads, are
allowed. It counts only the path's own statements, those
`run` and the async work it starts send, so another test or a background loop
using the same Knex meanwhile changes nothing; work a loop started earlier does
on the path's behalf is not counted either. `expectScoped` runs the path as owner A before and
after seeding owner B and fails when the answer changes, so it catches a report
that sums, counts or joins B's rows, not only one that returns them; it also
fails when the path changed or removed a row of B's. The path runs twice, so it
answers the same for the same rows: a write answers what repeats, such as the
ids it changed, not a fresh id or time.

An owner is whatever `seed` and `run` receive. On a workspace path it is a
signed-in member's options, built as the request pipeline builds them:
`{ context: { actor: { id: userId }, workspace: { id: workspaceId }, permissions } }`,
where `permissions` holds the member's role permissions. Seed with a job's
context, `{ context: systemContext(reason).forWorkspace(workspaceId) }`. A row
policy sees that context as `caller.kind` `"job"`, never as the member.

A data test never skips: without `TEST_DB_NAME` it fails
(`requireTestDatabase(process.env)`). Give `expectFlatQueries` the test's
`knex` whenever the features run on it (`startTestFeatures`,
`createTestResourceRuntime`). Without `knex` it counts through a server the
test booted (`countRuntimeQueries(work)` from
`@jskit-ai/database-runtime/server/testDatabases`). A check that measures
nothing never passes: "The path sent no statement at any size" means pass
`knex`, or the path never reached the database.

A package's own data test that creates its tables in the test takes its Knex
from `createPackageTestKnex(t, { environment: process.env })` (from
`@jskit-ai/resource-runtime/test`): an in-memory SQLite database, or on a
`DB_CLIENT=pg` run a schema of the test's own in `TEST_DB_NAME`, dropped after
it. The same file then proves its locks, many-row writes and upserts on
PostgreSQL too; compare counts with `Number()` (PostgreSQL answers them as
strings) and ids with `String()`.

`createTestResourceRuntime({ knex })` gives a test the resource runtime its
features own their tables through: `runtime.own(featureId, [resource])`
answers the handles, and `runtime.declareSystemScope(featureId, reason)` the
`systemContext` function a test reads every owner's rows with. One more test
proves every table has an owner:
`expectEveryTableOwned({ knex, runtime, infrastructureTables, environment })`
fails, naming them, when the migrated test database holds a table no feature
owns and no package keeps as infrastructure. JSKIT's packages export their
infrastructure tables for it: `LOCAL_AUTH_INFRASTRUCTURE_TABLES`
(`@jskit-ai/auth-provider-local-db-core/server/lib/index`),
`OIDC_CLIENT_INFRASTRUCTURE_TABLES` (`@jskit-ai/auth-provider-oidc-core/server/lib/index`)
and `OIDC_ISSUER_INFRASTRUCTURE_TABLES` (`@jskit-ai/oidc-issuer-core/server`).
`runtime` knows only the features the test started, so start every owner of a
migrated table, JSKIT's own included, and pass `runtime: resources` from
`startTestFeatures`. Local sign-in's tables belong to
`AuthLocalDatabaseBackendProvider`
(`@jskit-ai/auth-provider-local-db-core/server/providers/AuthLocalDatabaseBackendProvider`,
given `inputs: { "runtime.database": { knex } }`).
`LOCAL_AUTH_INFRASTRUCTURE_TABLES` lists only the identities table it keeps
outside resources.

A test of a feature and the owner APIs it requires starts them as the server
does, without HTTP: `startTestFeatures({ knex, features, requires, inputs,
createTables })` orders the features by their requires, owns their tables
through a test resource runtime, runs every boot (so `crud.contracts` is
sealed) and answers `{ capabilities, resources, stop }`. JSKIT's owners start
beside yours: `UsersExtensionsProvider` and `UsersIdentityProvider` give
`users.profiles`, and `WorkspaceRecordsFeature`
(`@jskit-ai/workspaces-core/test/WorkspaceRecordsFeature`) gives `workspaces`
and `workspaces.memberships` without the workspace routes. Never import another
package's repositories to build its owner API by hand.

A `defineCrudFeature` also requires `crud.contracts` and `runtime.http`, which
an application's server supplies. In a test, add `CrudContractsProvider`
(`@jskit-ai/crud-core/server/crudContracts`) to `features` and give
`inputs: { "runtime.http": { router: { register() {} } } }`. The routes are
then registered nowhere, and the test calls the feature's `service` and
`repository` directly.

```js
const { capabilities, stop } = await startTestFeatures({
  knex,
  features: [RosterFeature, WorkspaceRecordsFeature, UsersIdentityProvider, UsersExtensionsProvider],
  requires: { roster: "roster" }
});
t.after(stop);
```

A test of the routes themselves boots the application's server and signs
people in over `app.inject`. Keep one cookie jar per person and send the
session's `csrfToken` as `csrf-token` with every write. The session answer
carries no user id, so the test finds each person by email
(`users.profiles.findByEmail(email)`).

```js
const app = await createServer({ runtimeEnv: { ...resolveRuntimeEnv(), AUTH_LOCAL_EMAIL_CONFIRMATION: "false" } });

async function signUp(email, password) {
  const cookies = new Map();
  const send = async (options) => {
    const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await app.inject({ ...options, headers: { ...options.headers, cookie } });
    for (const header of [response.headers["set-cookie"] ?? []].flat()) {
      const [name, ...value] = header.split(";")[0].split("=");
      cookies.set(name.trim(), value.join("="));
    }
    return response;
  };
  const csrf = async () => (await send({ method: "GET", url: "/api/session" })).json().csrfToken;
  await send({ method: "POST", url: "/api/register", headers: { "csrf-token": await csrf() }, payload: { email, password } });
  await send({ method: "POST", url: "/api/login", headers: { "csrf-token": await csrf() }, payload: { email, password } });
  return send;
}
```

## Hard rules

These are always wrong, and lint reports them as errors in all code but a
package's client (`src/client`), the app's own `src/` included, since server
code sits there too. Tests, migrations and seeds (a `test/`, `migrations/` or
`seeds/` folder at the root of the app or of a package, or a `seed*` script in
its `scripts/`, `bin/` or root) are outside them; such a folder deeper in
server code is server code. Neither `eslint-disable`, an inline
`/* eslint ... */` config nor the app's ESLint config can turn them off.

### Lint rules

| Rule | Reports | Section |
| --- | --- | --- |
| `jskit/no-direct-knex` | a table reached by name with Knex, a `.knex` read or `knex` destructured, a transaction opened by hand | [The resource is the only door](#the-resource-is-the-only-door) |
| `jskit/no-transaction-reader` | `options.trx`, `trx \|\| knex`, a `trx = knex` default, `trx` destructured from options, any key but `context` and `trx` read from the `txOptions` work receives; a read an `if` tests before throwing points to `joinOnly` or `outermost` | [Transactions](#transactions) |
| `jskit/no-hand-scope` | a hand-written `where` on `workspace_id` or `workspaceId` | [Layer 1: the table resource](#layer-1-the-table-resource) |
| `jskit/sql-literal` | raw SQL built from strings or templates instead of one literal with bindings | [Layer 5: reports the resource cannot express](#layer-5-reports-the-resource-cannot-express) |
| `jskit/no-hand-context` | a system context made with `createSystemContext` or `declareSystemScope`, a context's `scopeValues` written by hand | [Background work](#background-work) |
| `jskit/knex-reason` | a `scopedQuery()` report outside a named repository method under `// Knex: <kind> - <reason>` | [Layer 5: reports the resource cannot express](#layer-5-reports-the-resource-cannot-express) |

### Exceptions

A module whose job is data access itself (a database runtime, a migration
runner, test-database setup, an operator's data import or cutover tool, a
database console that runs the person's own SQL) may opt out of
`jskit/no-direct-knex`, `jskit/no-transaction-reader`, `jskit/no-hand-scope`
and `jskit/sql-literal` as a whole, with one line per rule before its first
line of code:

```js
// readable-check: allow no-direct-knex - infrastructure: the test databases' snapshot and restore
```

In a file excused from `jskit/no-direct-knex`, raw SQL runs on Knex itself,
so `jskit/sql-literal` lets it hold a statement; it is still one literal with
its values as bindings. Only a module that runs SQL it is given by design (a
console's query runner) opts out of `jskit/sql-literal` itself, in that one
header line with its reason; never with a per-line disable. `jskit check`
lists every such file for review. `jskit/no-hand-context` and
`jskit/knex-reason` take no exception.

A data import or cutover tool (loading another system's records into the app's
tables before go-live, say) is the one application module that commonly takes
it. Check and judge, for each file:

- it runs only as an operator's command; nothing a request can reach imports
  it;
- it bypasses ownership and row policies on purpose, so every read and write
  names its workspace explicitly;
- it writes in one transaction per batch, so a failed batch leaves nothing
  half-loaded;
- its statements per row are still measured, as any write path's are: a batch
  of 200 rows costs about what a batch of 10 does.

`jskit check` also fails:

- a table with two table resources;
- a system scope or `systemContext` call without a reason;
- an infrastructure exception or a feature's system scope that the app's
  checked-in `jskit-data-access.json` does not list, so each new one is
  reviewed: `{ "infrastructure": [{ "file", "rule" }], "systemScopes":
  [{ "feature", "systemScope" }, { "file", "capability", "systemScope" }] }`;
- a module that requires a capability handing out rows past their owners:
  `runtime.database` or `runtime.resources` without the infrastructure
  exception (features own their tables with `owns`), and
  `realtime.audience-scope`, `auth.local.accounts`, `auth.local.sessions`,
  `auth.local.recovery`, `connectors.store`, `assistant.repositories` or
  `payments.store` until `systemScopes` lists that file and capability with
  its reason, in any spelling the kernel resolves (`Runtime.Resources`); a
  feature's own id counts only where it provides that capability;
- an `eslint-disable` that names a data-access rule, or no rule, or an inline
  `/* eslint ... */` config that sets one, outside client code;
- an app file that the app's ESLint config lints without every data-access
  rule as an error (`"jskit/no-direct-knex": "off"`, `dataAccessConfig(files,
  "off")`), or server code that it ignores, until `infrastructure` lists
  that file and rule. Server code is what the base config lints, at the app's
  root or a package's: its files (`server.js`), `src/` (an app's whole `src/`,
  `src/jobs/` with it), `server/`, `scripts/`, `bin/` and `config/`.

It reads none of what the app's ESLint config ignores outside server code,
such as a vendored copy of old code kept beside the app, since no lint reads
it either, and lists each directory and file it skipped.
