<!-- Generated from `packages/agent-docs/site/guide/framework/typed-features.md`. -->

# Typed features

Read this page before writing or reviewing JSKIT server code: a feature,
provider, action, service, repository, route, error or test. Each rule says
what to do, why in one line, and shows good and bad code. `npm run lint`
reports the rules a machine can see ([checks](#checks)); the others are
checked by reading. The `server/feature-package` pattern in the
[bundled source pattern index](pattern-index.md) is the smallest complete feature to copy.

The [typed features heuristic](heuristics/typed-features.md)
maps keywords and lint findings to the section that fixes them. Client code
(composables, components, client factories and providers) follows the same
rule in [client features](client-features.md).

## The rule

> Every collaborator a feature uses arrives through its declared JSKIT
> capabilities, and is typed where it is received and required, never probed,
> so each call has exactly one visible destination for a reader and for the
> code map.

- A **capability** is a value a feature `provides`, `requires` or may use
  (`optional`), named by a **token** such as `"feature.invoices"`.
- A **collaborator** is an object or function with behaviour that code calls:
  a service, store, repository, runtime, router, publisher, catalogue, logger
  or clock. Plain data (an input, a record, a list, an options bag) is not one.
- A **slot** is a place that holds one value someone else supplies.
- A **refusal** is an error meant for the caller: bad input, not found,
  forbidden, conflict.

Following a call then takes one step: the parameter names its type, the type
names its file. The architecture inspector's code map takes the same step, so
it reports the call as exact instead of guessing from the method name.

## Features

### Feature files

**A `defineFeature` lives in `<Name>Feature.js`, its keys in one order, one
per line: `id, domain, requires, optional, provides, setup, actions, boot,
shutdown`.** A `defineProvider` lives in `<Name>Provider.js`.

- `setup` builds each provided value with a named `create<Name>` factory from
  a module of its own, never inline.
- `actions` is a method that returns `create<Name>Actions({ … })`.
- The hooks take `capabilities`, destructured and typed.

Why: every feature reads the same way, top to bottom.

```js
// good
const InvoicesFeature = defineFeature({
  id: "feature.invoices",
  requires: {
    database: "runtime.database"
  },
  provides: {
    invoices: "feature.invoices"
  },
  /** @param {{ database: import("@jskit-ai/database-runtime/server/types").RuntimeDatabase }} capabilities */
  setup({ database }) {
    return { invoices: createInvoices({ knex: database.knex }) };
  },
  actions({ invoices }) {
    return createInvoiceActions({ invoices });
  }
});

// bad: the value built inline, the actions an inline array
setup: ({ database }) => ({ invoices: { list: () => database.knex("invoices") } }),
actions: ({ invoices }) => [{ id: "invoices.list", execute: () => invoices.list() }]
```

### Capability types

**Each provided token has one `@typedef` in its package's `src/server/types.js`,
exported as `./server/types`. A type used in two or more files is named once
there.**

- Derive it from the factory, `ReturnType<typeof createInvoices>`, and name it
  after the token in PascalCase (`feature.invoices` is `Invoices`). Each token
  gets its own name, even when it aliases another type.
- Import a type from the package that owns it; never re-alias it through
  another module. A JSDoc `import("…")` is type-only, so a package cycle is no
  reason to hand-write one.
- Hand-write a contract only for a token with several implementations (such as
  `auth.service`), in its owning package, with optional operations marked
  optional.
- JSKIT's names: `RuntimeKnex`, `RuntimeKnexTransaction`,
  `RuntimeKnexQueryBuilder`, `RuntimeRouter`, `RuntimeLogger`, `RuntimeEnv`,
  `CrudService`, `CrudRepository`.

Why: a typed parameter tells a reader and the code map which file a call
reaches.

```js
// good: src/server/types.js
/** @typedef {ReturnType<typeof import("./invoices.js").createInvoices>} Invoices */
export {};
// a consumer in another package
/** @param {{ invoices: import("@local/invoices/server/types").Invoices }} dependencies */

// bad: spelled out at every use, or a hand-written interface of `any`
/** @param {{ invoices: ReturnType<typeof import("../../invoices/src/server/invoices.js").createInvoices> }} dependencies */
/** @typedef {{ list: (...args: any[]) => Promise<any> }} InvoiceReads */
```

### Typed collaborators

**Every factory, constructor, hook and helper that calls a collaborator
destructures it in its signature and types it with a JSDoc `@param`.**

- That includes `setup()`, `boot()` and `shutdown()`, route registrars,
  formatters and repository helpers. A hook that only passes capabilities on
  needs no type.
- Pure helpers (validators, mappers, id builders) are imported, never passed
  in.

Why: the type is what turns a call into one step.

```js
// good
/**
 * The invoices the feature provides.
 * @param {{ knex: import("@jskit-ai/database-runtime/server/types").RuntimeKnex }} dependencies
 */
function createInvoices({ knex }) {

// bad: untyped, read from a bag in the body
function createInvoices(dependencies) {
  const knex = dependencies.knex;
```

### Required collaborators

**A collaborator is required: no `= null`, `= {}` or no-op default, no `typeof
x.method === "function"` probe, no `x?.method?.()` and no "x is required"
guard.**

- A default that is the production implementation stays: `fetchImpl =
  globalThis.fetch`, `now = Date.now`. One clock per factory.
- An *optional operation* is a contract method some real implementer lacks.
  An operation every implementer has, including one that refuses while its
  feature is switched off, is required and never probed.
- A per-call callback in an options bag is data: resolve it once with a named
  no-op, `const { onProgress = reportNoProgress } = options`.
- A public entry point that checks what an application hands it, such as
  `defineFeature()` checking a definition, is input validation and stays, with
  its [exception comment](#exceptions).

Why: the capability runtime already refuses to start without a required
token; a probe gives each call a second, invisible outcome.

```js
// good
function createReminders({ mailer, now = Date.now }) {
  async function send(invoice) {
    await mailer.send(invoice.email, { sentAt: now() });
  }

// bad
function createReminders({ mailer = null, onSent }) {
  async function send(invoice) {
    if (typeof mailer?.send !== "function") return;
    await mailer.send(invoice.email);
    onSent?.(invoice);
  }
```

### One shape per value

**A value arrives in one shape. Never accept `capability.service ||
capability` or `x?.value ?? x`.**

Why: production takes one branch and the tests take the other, so a reader
follows two.

```js
// good: a CRUD capability's service, and a test double with the same shape
const audits = auditsCapability.service;
createAuditing({ auditsCapability: { service: auditsDouble } });

// bad
const audits = auditsCapability.service || auditsCapability;
```

### Environment from the caller

**Code reads the environment its caller passes, typed `RuntimeEnv`. Only the
application's entry point reads `process.env`, and passes it on.**

- A third-party client is a named default resolved once in the factory that
  owns it: `mailClient = createMailClient(config)`.
- An application loads `.env` once per process, in one module every entry
  point calls.

Why: a function that falls back to the process environment hides a caller
that forgot to pass one, and every test inherits the developer's shell.

```js
// good
/** @param {{ env: import("@jskit-ai/kernel/server/types").RuntimeEnv }} options */
function createMailer({ env }) {
// server.js, the entry point
const mailer = createMailer({ env: resolveRuntimeEnv() });

// bad
function createMailer({ env = process.env } = {}) {
```

### Optional tokens

**A slot is an `optional` token with a named default, resolved once in
`setup()` with `??`.**

- The declaring package names the default beside the slot's type
  (`sequentialNumbering`).
- `X | null` appears only at the receiving hook; what `setup()` builds
  receives the value as required. A disabled implementation is a named value
  (`DISABLED_MAILER`), never `null`.
- Anything that holds one value is a slot, however it is named (`set*`,
  `register*`, `attach*`). Catalogues stay catalogues: routes on
  `http.router`, contributors on `runtime.bootstrap`, listeners on
  `runtime.events`, actions and placements.
- When the slot's supplier requires the slot's owner, the two form a cycle.
  Split the part of the owner the supplier needs into its own feature. Until
  then the setter stays, with a `cycle:` [exception comment](#exceptions), and
  is cleared at shutdown.

Why: a slot filled later makes a call's destination depend on what ran
before.

```js
// good: the owner declares the slot and resolves it once
optional: {
  numbering: "feature.invoices.numbering"
},
/** @param {{ numbering: import("./types.js").InvoiceNumbering | null }} capabilities */
setup({ numbering }) {
  return { invoices: createInvoices({ numbering: numbering ?? sequentialNumbering }) };
},
// another package fills it by providing the token
const YearlyNumberingFeature = defineFeature({
  id: "feature.yearly-numbering",
  provides: {
    numbering: "feature.invoices.numbering"
  },
  setup: () => ({ numbering: yearlyNumber })
});

// bad
let numbering = sequentialNumbering;
function setNumbering(next) {
  numbering = next;
}
```

### Owned state

**A capability owns its state: built in `setup()`, started in `boot()`,
stopped in `shutdown()`. No module-level registry, and no module state
filled after construction.**

- A private memo cache that nothing fills after construction is fine, and so
  is a private concurrency guard over a process-wide resource, with a comment
  saying so.
- No late-bound closures between two tokens of one feature: the consumer
  requires the other token.

Why: module state is shared by every runtime in the process and outlives
`shutdown()`.

```js
// good
setup() {
  return { jobs: createJobQueue() };
},
boot({ jobs }) {
  jobs.start();
},

// bad
const handlers = new Map();
export function registerHandler(name, handler) {
  handlers.set(name, handler);
}
```

### Shutdown mirrors setup

**`shutdown()` takes the same early returns as `setup()` and releases exactly
what `setup()` registered, with no `?.()` or `?? []` guard.**

- When a `register()` returns its release, keep it and call it at shutdown.

Why: a guarded release hides a setup that never ran, or one that ran twice.

```js
// good
setup({ events }) {
  if (!config.remindersEnabled) return {};
  return { reminders: createReminders({ events }) };
},
shutdown({ reminders }) {
  if (!config.remindersEnabled) return;
  return reminders.stop();
}

// bad
shutdown({ reminders }) {
  return reminders?.stop?.();
}
```

### Loggers

**The logger is required, typed `RuntimeLogger`, and called pino-style:
`logger.warn({ error, ...fields }, "Sentence.")`.**

- Only where a real caller may omit it does it default to the kernel's
  `silentLogger` (`@jskit-ai/kernel/server/runtime/logger`). Never `logger =
  null` with `if (!logger) return`, and never `logger = console`.
- The foundations' logger options serialize `error` like `err`, so the message
  and stack are kept.

Why: one shape keeps every log line searchable by its fields.

```js
// good
logger.warn({ error, invoiceId }, "The reminder failed; the next run retries it.");

// bad
logger?.warn?.(`Reminder failed: ${error.message}`);
```

## Actions

### Action creators

**A feature's actions come from one `create<Name>Actions({ <capability> })`,
destructured, in `<name>Actions.js`. Each definition is a frozen literal
inside it, and so is the list.**

- Each id is a string literal or an `ACTION_*` module constant, exported for
  the routes that run it.
- Actions of another concern live in a file named after that concern.
- The capability keeps the provider's name (`invoices`, not
  `invoicesService`); only a second version of one capability gets a role name
  (`unauditedInvoices`).

Why: a reader finds every action, and the method it reaches, in one place.

```js
// good
const ACTION_LIST_INVOICES = "invoices.list";

/** @param {{ invoices: import("./types.js").Invoices }} dependencies */
function createInvoiceActions({ invoices }) {
  return Object.freeze([
    Object.freeze({
      ...QUERY_ACTION,
      id: ACTION_LIST_INVOICES,
      input: listInvoicesInput,
      execute: (input, context) => invoices.list(input, { context })
    })
  ]);
}

export { ACTION_LIST_INVOICES, createInvoiceActions };

// bad: positional, and built by a helper
function createInvoiceActions(invoices) {
  return [queryAction("invoices.list", invoices.list)];
}
```

### One-line execute

**`execute: (input, context) => service.method(…)` makes exactly one call:
no `async` or `await`, no body, no envelope, no helper that builds or strips
it, and no `input || {}`.**

- The service returns the final result, its JSON:API document included.
- A key that must not reach the service is destructured in the parameters:
  `execute: ({ workspaceSlug, ...changes }, context) => invoices.update(changes, { context })`.
- Flags go into the input or the context, never into a third argument.
- A CRUD custom action keeps its declaration's own
  `execute: ({ input, context, service }) => service.method(…)`, and its map
  key names it; never write an id equal to the default crud-core builds.

Why: each action shows the one method it reaches.

```js
// good
execute: (input, context) => invoices.send(input, { context })

// bad
execute: async (input = {}, context) => {
  const invoice = await invoices.send(input || {}, { context });
  return { data: invoice };
}
```

### Shared action fields

**Fields many actions share (`version`, `kind`, `channels`, `surfaces`) come
from one frozen constant per kind, spread first into each literal. The other
keys follow in this order: `id, input, output, permission, events, execute`.**

- An application keeps one query and one command constant in its shared
  package; a package defines its own only when its values differ.
- An empty `events` is left out.

Why: each literal reads complete, and one edit changes every action's
channels.

```js
// good
const QUERY_ACTION = Object.freeze({
  version: 1,
  kind: "query",
  channels: ["api", "automation", "internal"],
  surfaces: ["app"]
});

// bad: half the fields in the feature's actionDefaults, half in each literal
defineFeature({ actionDefaults: { channels: ["api"] }, … });
Object.freeze({ id: ACTION_LIST_INVOICES, kind: "query", … });
```

### Strict action inputs

**An action's input is validated in create mode, the default: `required` is
enforced and defaults are applied. Only an action that updates part of a
record declares `mode: "patch"`; a command never does.**

- Patch mode skips `required`, so a service keeps its guard for a field a
  patch input lists as required.
- An input field lists its allowed values with `enum`; the kernel refuses
  `oneOf` on an input field at startup, because json-rest-schema checks no
  `oneOf` and the field would accept any value.

Why: a command whose required field is never enforced reaches the service
without it.

```js
// good
input: { schema: sendInvoiceSchema }                  // a command: invoiceId is enforced
input: { schema: invoiceChangesSchema, mode: "patch" } // a partial update

// bad: a command in patch mode, so its required invoiceId is never enforced
input: { schema: sendInvoiceSchema, mode: "patch" }
```

### No idempotency

**An action declares no idempotency; the kernel refuses the field at startup.
An action that must tolerate a repeated request handles it in its own domain
(a unique key, an upsert, a state check) and says so in a comment where that
is not obvious.**

Why: a label nothing enforces promises a guarantee nobody keeps.

```js
// good: the service returns an invoice that is already sent unchanged
execute: (input, context) => invoices.send(input, { context })

// bad
idempotency: "optional",
```

### The action policy

**A rule every action of an application obeys (who may run it, the record it
acts within, the scope it runs in) is data in each definition's
`extensions`, applied by the application's one `runtime.actions.policy`.
Never a helper that wraps every definition.**

- `input(definition)` runs once, when the action is registered, and returns
  the input schema the action is validated and listed with.
- `execute({ definition, input, context, run })` runs on every execution,
  after the kernel's channel, surface, permission and input checks, and calls
  `run(input, context)` with what the action should receive. It can refuse,
  adjust the input or context, or run the action inside a scope.
- The policy comes from a provider (a feature requires `runtime.actions`,
  which would close a cycle), and passes every action whose `extensions` it
  does not recognise straight to `run`.

Why: a wrapper makes every definition's `execute` the wrapper's, so neither a
reader nor the code map sees the call it makes.

```js
// good
Object.freeze({ ...COMMAND_ACTION, id: ACTION_UPDATE_NOTE, extensions: { records: OWNER_ONLY }, execute: (input) => notes.update(input) })
const RecordScopePolicyProvider = defineProvider({
  id: "app.action-policy",
  provides: {
    policy: "runtime.actions.policy"
  },
  setup: () => ({ policy: recordScopePolicy })
});

// bad
withRecordScope({ id: ACTION_UPDATE_NOTE, …, execute: (input) => notes.update(input) }, { ownerOnly: true })
```

### Request context

**A package reads the request, the actor and the workspace from an action
context one way, through the kernel's readers, and its actions pass the
context one way.**

- `resolveRequest(context)`, `resolveActor(context)` and
  `resolveActorId(context)`, from
  `@jskit-ai/kernel/server/actions/actionContributorHelpers`.
- The workspace comes from the context only. A record's workspace may be
  checked against it, never used as a fallback.
- `?.` and `|| null` variants count as different forms.

Why: each form treats an absent actor differently, so one action behaves
differently depending on its path.

```js
// good
const actorId = resolveActorId(context);

// bad
const actorId = context?.actor?.id || options.context?.user?.id || null;
```

## Services and repositories

### Validated input as is

**A method that receives an action's validated input takes it as it is: no
`input = {}`, no `input?.x` and no second parse of what the schema checked.**

- Destructure with the schema's absent value: `{ name, note = "" }`.
- A contract operation other callers reach drops `= {}` and `?.` too, since
  the contract types its input, and still validates what it receives.

Why: two validators drift apart, and the service seems to accept values the
action refuses.

```js
// good
async function rename({ invoiceId, name }, { context }) {

// bad
async function rename(input = {}, options = {}) {
  const name = String(input?.name || "").trim();
```

### Options and defaults

**Resolve each default once, at the feature or the public entry point; below
it, destructure and use.**

- An options bag whose fields are optional by contract keeps `options = {}`,
  with no `?.` or second `|| {}` on it. Pass it on as `options`, or
  `{ ...options, trx }` inside a transaction.
- A parameter or bag no caller passes is dropped and its values written in
  place. A helper's argument takes no default unless a real caller omits it,
  and a default never comes before a required parameter.
- Two behaviours are two methods: no boolean mode parameter and no `skip*`
  flag. A construction-time setting, and a boolean that is column data
  (`setArchived({ archived })` behind `archive` and `restore`), are fine.

Why: a value with two defaults has two meanings, and a mode flag hides a
second method inside the first.

```js
// good
async function list(query, options = {}) {
  return resolveRepoClient(knex, options)("invoices").where(query);
}

// bad
async function list(query = {}, options = {}) {
  const client = options?.trx || knex;
}
async function save(invoice, skipAudit = false) {
```

### Frozen results

**Every `create*` returns `Object.freeze({ … })` of named inner functions.
Action definitions and their lists are frozen too.**

Why: a caller cannot replace a member, and each member has a name the code
map shows.

```js
// good
function createInvoices({ knex }) {
  async function list(query) { … }
  async function send(input, options) { … }
  return Object.freeze({
    list,
    send
  });
}

// bad
return { list(query) { … }, send: async (input) => { … } };
```

### Named members

**A factory exposes another factory's functions by name, never by spreading
its result.**

- Spreading is for a `decorateService` or `decorateRepository` over the JSKIT
  CRUD service or repository, whose members are the contract's, and for data.

Why: a spread hides where a member comes from, and a later spread silently
replaces an earlier member.

```js
// good
return Object.freeze({
  list: reads.list,
  send: writes.send
});

// bad
return Object.freeze({ ...createInvoiceReads(dependencies), ...createInvoiceWrites(dependencies) });
```

### One helper per package

**Each pure helper exists once per package and is imported. A helper the
kernel owns is imported from it. A non-pure check two packages make the same
way (is this user an operator) is a member of its owner's capability.**

- The kernel's `@jskit-ai/kernel/shared/support/normalize` holds
  `normalizeText` (every falsy value is empty), `toText` (only `null` and
  `undefined` are), `isRecord` and their siblings; check each call site's
  meaning of 0 and false before replacing a copy.
- A helper two packages of an application use lives in its shared package,
  never inside one of them.

Why: the kernel's helpers fix one meaning of empty, and a copy brings its own.

```js
// good
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// bad: a third copy, with its own idea of empty
function normalizeText(value) {
  return String(value || "").trim();
}
```

### One reader per fact

**A fact that a call's options or context carry is read through its owner's
helper, never by hand.**

| Fact | Reader |
| --- | --- |
| the call's transaction, or the client to query through | `resolveTransaction(options)`, `resolveRepoClient(knex, options)` (`@jskit-ai/database-runtime/shared`) |
| what a service hands its repository | `repositoryCallOptions(options)` (`@jskit-ai/crud-core/server/jsonApiService`), only at the repository call |
| the signed-in user | `resolveActor(context)`, `resolveActorId(context)` |
| a tagged result's records, or its document | `simplifyJsonApiResult(result)`, `jsonApiResultValue(result)` (`@jskit-ai/http-runtime/shared`) |
| a collection's next-page cursor | `jsonApiNextCursor(document)` (`@jskit-ai/http-runtime/shared`) |
| a created record's id | `resolveCrudJsonApiEntityIdFromResult(result)` (`@jskit-ai/crud-core/server/serviceEvents`) |
| a CRUD record change's event | `buildCrudRecordChangedEvent({ namespace, operation, entityId, audience })` (`@jskit-ai/crud-core/server/serviceEvents`) |
| the workspace a request asks for, before any action context | `requestedWorkspaceScope(request)` (`@jskit-ai/workspaces-core/server/support/workspaceRouteInput`) |
| a context's workspace id | `resolveWorkspaceScopeValue(context)` (`@jskit-ai/json-rest-api-core/server/jsonRestApiHost`) |

Why: each reader knows every place JSKIT keeps its fact (`trx` or
`transaction`, a tagged result's wrapper), and a hand read misses one.

```js
// good
const trx = resolveTransaction(options);

// bad
const trx = options?.trx || options?.transaction || null;
```

### Every row

**A server-side resource query that needs every row it matches reads them
with `queryAllJsonRestCollectionRows(resource, params, context)`
(`@jskit-ai/json-rest-api-core/server/jsonRestApiHost`). A query without a
page means "the first 20 rows".**

- json-rest-api answers a query that names no page with the resource's
  default page, 20 rows, and says nothing about the rest. The CRUD
  repository's `queryDocuments(query)` without a `limit` is the same first
  page, and one with a `limit` above its `queryMaxLimit()` (100) throws,
  because json-rest-api would answer only 100. A CRUD read of every record
  uses the repository's `queryEveryDocument(query, options)`, which answers
  one JSON:API document `{ data, included }` with no `limit`, `cursor` or
  `sort`.
- The helper reads cursor pages of 1,000 rows (json-rest-api's server-only
  `pageSizeLimit`; a resource whose `queryMaxLimit` is larger uses that) in id
  order until none follows, keeping the call's transaction and context, so no
  row is skipped or repeated. Each page pays the row policy and linkage
  queries once, so 480 rows cost 3 statements, not 15. It sets the page and
  sort itself; sort the rows it returns.
- A lookup by a unique key (an id, a slug, a token hash, a unique pair such
  as workspace and user) matches at most one row and may read `rows[0]` of a
  plain query. A read of the newest or first few rows names its own `sort`
  and `page`.
- HTTP list routes keep the caller's page: their default and maximum page
  sizes are public behaviour, not a server-side limit to raise.

Why: a list read without a page looks complete until the 21st row, then
silently drops the rest from every person picker, scope and delivery built on it.

```js
// good
const rows = await queryAllJsonRestCollectionRows(api.resources.workspaceMemberships, {
  queryParams: { filters: { workspace: workspaceId, status: "active" }, include: ["user"] },
  transaction: resolveTransaction(options),
  format: "plain"
}, options.context);

// bad: the first 20 members only
const rows = extractJsonRestCollectionRows(await api.resources.workspaceMemberships.query({
  queryParams: { filters: { workspace: workspaceId, status: "active" }, include: ["user"] },
  transaction: resolveTransaction(options),
  format: "plain"
}, createJsonRestContext(options.context)));
```

### Lists read related rows in batches

**A read that builds a list fetches its related rows in batches, an id-list
query per related table, and groups them in memory, so its query count follows
the tables and pages it reads, not the rows.**

- Collect the ids from the first read, then read each related table with an
  id-list filter: a `searchSchema` entry
  `{ type: "array", actualField: "<column>", filterOperator: "in" }`, read
  through `queryAllJsonRestCollectionRows()`, or the resource's `include`.
  Group the rows by id with `Map.groupBy()`.
- A count that grows with the rows means something runs per row:
  `getDocumentById()`, `queryDocuments()`, a service `get` or another owner's
  single-record read inside a loop over the list, however the loop is spelled
  (`for`, `map` with `Promise.all`, a helper called per item), or a
  single-record helper reused for a list.
- Work derived from a row (hashing, preparing a form, assembling a snapshot)
  runs once per distinct input in the call, not once per row it appears in.
- A JSON:API read also costs a few lookup and visibility queries per page and
  relationship field, and pages hold the resource's `queryMaxLimit` (100 rows
  unless it sets one). That cost follows pages, so three hundred invoices take
  a few more queries than ten, not three hundred more ([Query counts at
  realistic sizes](#query-counts-at-realistic-sizes)).

Why: each JSKIT single-record read runs its lookups and row policy too, so a
read per row repeats all of them.

```js
// good: a read per related table, however many invoices there are
const invoiceRows = await queryAllJsonRestCollectionRows(api.resources.invoices, {
  queryParams: { filters: { workspace: workspaceId } },
  transaction: resolveTransaction(options),
  format: "plain"
}, options.context);
const lineRows = await queryAllJsonRestCollectionRows(api.resources.invoiceLines, {
  queryParams: { filters: { invoiceIds: invoiceRows.map((invoice) => invoice.id) } },
  transaction: resolveTransaction(options),
  format: "plain"
}, options.context);
const linesByInvoice = Map.groupBy(lineRows, (line) => line.invoiceId);
return invoiceRows.map((invoice) => ({ ...invoice, lines: linesByInvoice.get(invoice.id) || [] }));

// bad: one more query, and its lookups and row policy, for every invoice
for (const invoice of invoiceRows) {
  invoice.lines = await invoiceLines.queryDocuments({ invoiceId: invoice.id }, options);
}
```

### Bounded access checks

**A row policy costs what the rows its query reads cost, never what the
subject's stored history costs, and a write decides access once instead of
paying a read policy for every row it writes.**

- A `rowPolicy` adds one predicate to the query it is given: a join, `EXISTS`
  or subquery correlated with the row being read, on indexed columns. It never
  loads everything the subject was ever linked to (every source, notice or
  grant in their history) to build an `IN` list, and never calls another
  owner's access check once per item of that history. The
  [row policies heuristic](heuristics/row-policies.md)
  has the policy contract and its package composition.
- The policy runs on every single-record read, and a CRUD write includes one:
  `createDocument()` and `patchDocumentById()` default to `returning: "full"`,
  which reads the record back through the policy, and `patch` and `delete`
  first look the record up through it.
- A write path decides access once, inside its transaction. A write that does
  not use its result passes `returning: "minimal"` or `"none"`, and a batch of
  creates (a delivery, an import, a fan-out) goes through
  `createDocuments(payloads, { trx, context })`, which reads nothing back
  unless asked
  ([writes that return less](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/database-layer#writes-that-return-less)).
  Any other batch whose per-row lookup would pay an expensive policy writes
  through a repository method added with `decorateRepository`, on
  `resolveRepoClient(database.knex, options)`, setting the same columns the
  resource would, its ownership columns included.
- Its test counts the queries of one read and one write for a subject with a
  short history and for one with a long one ([Query counts at realistic
  sizes](#query-counts-at-realistic-sizes)).

Why: the row policy runs on every read, write read-back and lookup, so every
request pays what it costs.

```js
// good: one predicate on the row being read
function noticeVisibilityPolicy({ query, context, column, value, db }) {
  const userId = resolveActorId(context);
  if (!userId) return false;
  query.where(column("recipientId"), value("recipientId", userId)).whereExists(
    db("sources").select(1)
      .whereColumn("sources.id", column("sourceId"))
      .where("sources.status", "published")
  );
  return true;
}

// bad: every source the recipient was ever notified about, checked one by one
async function noticeVisibilityPolicy({ query, context, column, value }) {
  const sourceIds = await noticeHistory.listSourceIds(resolveActorId(context));
  const readable = [];
  for (const sourceId of sourceIds) {
    if (await sources.canRead(sourceId, context)) readable.push(sourceId);
  }
  query.whereIn(column("sourceId"), readable.map((id) => value("sourceId", id)));
  return true;
}
```

### Routes

**A route does HTTP work only (status, cookies, redirects) and runs an action
for anything that reads or writes the domain.**

- Registration lives in `registerRoutes.js`, or in `<concern>Routes.js`
  exporting `register<Concern>Routes` when there are several.
- One handler shape: a named async function that sends what
  `request.executeAction({ actionId: ACTION_X, input })` returns.
- A route that bypasses actions (a provider's callback) gets its own named
  registrar. Summaries are sentences.
- A route that repetition can abuse (sign-in, codes, sending email) declares
  `rateLimit: { max, timeWindow }`, which the kernel enforces per client
  address and refuses with 429, `kernel.http.rateLimited` and `Retry-After`.
  A limit worth changing per application is read from its config, as
  `config.auth.rateLimits` is.

Why: an action is the one place a domain operation's policy, input and
events are declared.

```js
// good
router.register("POST", "/api/invoices/:invoiceId/send", { auth: "required", meta: { summary: "Sends an invoice." } },
  async function sendInvoice(request, reply) {
    reply.code(200).send(await request.executeAction({ actionId: ACTION_SEND_INVOICE, input: request.input.params }));
  });

// bad: the route reads storage itself
router.register("GET", "/api/invoices", {}, async (request, reply) => reply.send(await knex("invoices")));
```

## Errors

### Refusals carry their own code

**A refusal is `new AppError(status, message, { code, params })`, or a
subclass of `AppError`, with a code of its own: one code per distinct
sentence, and `params` for the values in it.**

- One code convention per package (`billing.invoice.notFound`); codes are
  stable and never numbered.
- Where callers branch on a shared code, keep it and add a `messageCode` (and
  `messageParams`) per sentence. Input validation that carries per-field
  `details` may share one code.
- An error class extends `AppError` and gives each refusal its own code. One
  that takes extra fields destructures them and forwards the rest to `super`
  (`constructor(message, { approval, ...options })`), so each construction
  passes its own code. A project's coded builder, such as
  `billingError(message, code)`, is fine when every call passes its own code. A function converting a caught error is
  `to<What>Error(error, …)`; one returning refusal text is `*Message`.
- The kernel's `NotFoundError`, `ConflictError` and `DomainError` default to
  one shared code, so each call passes its own.

Why: a client tells refusals apart by their code and shows each in the
user's language ([translation](translation.md)).

```js
// good
throw new AppError(409, "The invoice is already sent.", { code: "billing.invoice.alreadySent" });
throw new AppError(422, "The note is too long.", { code: "billing.note.tooLong", params: { max: 500 } });

// bad
throw new AppError(409, "The invoice is already sent.");
throw new NotFoundError("Invoice not found.");
```

### Internal failures are plain errors

**An internal invariant or an unexpected failure is `throw new Error(message)`.
The caller sees "Internal server error." and the message stays in the log.**

- JSKIT's HTTP handler shows an `AppError`'s message at any status, so an
  `AppError` at 5xx is only for a failure the caller can act on.

Why: an internal failure dressed as a refusal leaks its details and promises
the caller a fix it cannot make.

```js
// good
throw new Error(`Invoice ${invoiceId} has no ledger entry.`);

// bad
throw new AppError(500, `Invoice ${invoiceId} has no ledger entry.`, { code: "billing.ledger.missing" });
```

### One construction per error

**An error gets its status and code when it is constructed, never patched on
afterwards.**

Why: a patched `Error` is neither a coded refusal nor a hidden failure, and
the next edit drops the patch.

```js
// good
throw new AppError(404, "Invoice was not found.", { code: "billing.invoice.notFound" });

// bad
throw Object.assign(new Error("Invoice was not found."), { statusCode: 404 });
```

### Failures are logged, not swallowed

**A best-effort `.catch` around a collaborator call logs the error and
carries on.**

- A silent catch stays only for cleanup on platform objects
  (`response.body.cancel()`), for queue tails whose error reaches the queued
  caller, and for client best effort, each with a short comment saying so.

Why: a collaborator call's failure can be a wiring `TypeError`, and
`() => {}` hides it with the rest.

```js
// good
publisher.publish(event).catch((error) => logger.warn({ error, eventId: event.id }, "Publishing failed; the record is saved."));

// bad
publisher.publish(event).catch(() => {});
```

## Tests

### Doubles use documented seams

**A test double replaces an owner only through its documented seams (an
injected collaborator, a provider client, an option), with the real shape.
It never copies an internal protocol such as an id format or a stream
frame.**

- Complete a double with the method the code calls, returning its neutral
  value; never shape production code around a double.

Why: an owner's seams are its contract; its id formats and stream frames
change with its package.

```js
// good
const invoices = createInvoices({ knex, mailer: { send: async () => ({ accepted: true }) } });

// bad: production code that exists for the double
if (typeof mailer.send !== "function") return;
```

### Tests are not callers

**A parameter, option or default that only tests pass, or a method only test
doubles lack, is no reason to keep it: drop the seam and complete the
double.**

- One named clock per factory (`now = Date.now`) is a platform default, not a
  test seam.

Why: a factory's parameters are its contract with the features that call it,
and a test is not one of them.

```js
// good
function createReminders({ mailer, now = Date.now }) {

// bad
function createReminders({ mailer, now = Date.now, skipDelay = false, testHooks = {} }) {
```

### No test-only exports

**A module exports only what other production modules import; an actions
file exports its creator and its `ACTION_*` ids. Tests reach everything else
through the feature, and pure helpers through `__testables`.**

- `__testables` holds pure helpers only, never one that touches a
  collaborator or reads request facts.

Why: `__testables` is the one way a test reaches inside a module, so every
other export is production API.

```js
// good
const __testables = Object.freeze({ nextInvoiceNumber });
export { createInvoices, __testables };

// bad
export function resetInvoiceCacheForTests() {
  cache.clear();
}
```

### Query counts at realistic sizes

**A list, batch or write path's database test counts its queries with the
test Knex instance's `query` event at a few rows and at a realistic number,
and fails when the count grows with the rows instead of the pages.**

- Pages add a few queries; rows should add none. A path that pages nothing
  (one read, one write) compares a short and a long history.
- When it fails, fix the reads ([Lists read related rows in
  batches](#lists-read-related-rows-in-batches), [Bounded access
  checks](#bounded-access-checks)).

Why: JSON:API reads add queries per page and relationship field, so comparing
two sizes separates that cost from a read per row, where one fixed number
cannot.

```js
// good
async function countQueries(knex, work) {
  let queries = 0;
  const count = () => { queries += 1; };
  knex.on("query", count);
  try {
    await work();
  } finally {
    knex.off("query", count);
  }
  return queries;
}

test("the invoice list's queries follow its pages, not its invoices", async () => {
  const listAt = async (count) => {
    const workspace = await createWorkspace(knex);
    await seedInvoices(knex, { workspace, count, linesEach: 5 });
    return countQueries(knex, () => invoices.listWithLines(workspace, { context }));
  };
  const few = await listAt(10);
  const many = await listAt(300);
  // Thirty times the invoices may add pages; a read per invoice would add about 290 queries.
  assert.ok(many <= few * 2, `${few} queries for 10 invoices, ${many} for 300`);
});

// bad: three invoices, nothing counted, so a read per invoice passes
test("the invoice list has its lines", async () => {
  await seedInvoices(knex, { workspace, count: 3, linesEach: 1 });
  assert.equal((await invoices.listWithLines(workspace, { context })).length, 3);
});
```

### Test files run in parallel

**A test suite runs its files in parallel, as many at a time as the machine's
test budget allows: never one file at a time, and never more than the machine
can take. Node's test runner runs through `jskit test`; Playwright's `workers`
and Vitest's `maxWorkers` come from `testConcurrency()`.**

- The budget is `V64_TEST_CONCURRENCY` when it is a positive whole number (a
  test runner that hands out slots exports it for each run), otherwise half of
  the machine's CPUs, rounded down and at least 1: a 2-vCPU VPS runs one file
  at a time, an 8-thread machine four.
- `jskit test` (from `@jskit-ai/jskit-catalog`) passes its arguments to
  `node --test` and sets `--test-concurrency` to the budget.
  `testConcurrency()` from `@jskit-ai/jskit-catalog/test-budget` returns the
  same number for a config.
- No script passes a fixed concurrency or worker count. `jskit check` fails a
  package script that runs `node --test` directly or passes one, and a
  Playwright or Vitest config those scripts use whose workers do not come from
  `testConcurrency()` ([test-run rules](#test-run-rules)).
- Each file isolates what it shares: a port the system picks (`listen(0)`), a
  directory from `mkdtemp`, its own database or schema with a name no other
  file uses, its own Vite `cacheDir` for each dev server it starts (Vite
  replaces a shared dependency cache under servers still reading it), and no
  writes into the source tree. Files that collide are isolated, never
  serialised. A database test file gets its own copy of `TEST_DB_NAME` from
  `jskit test --databases`
  ([integration test databases](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/database-layer#integration-test-databases)).
- An application's `playwright.config.mjs` is
  `defineConfig(browserTestConfig({ testDir: "./tests/e2e" }))` from
  `@jskit-ai/jskit-catalog/browser-tests`. It builds the production frontend
  once (reused while its sources are unchanged) and gives each worker its own
  server, port and, through its `prepare` module, its own seeded database; a
  spec file's tests run in order in one worker. With `PLAYWRIGHT_BASE_URL`, the
  tests use that managed target as its host serves it. Every run is bounded by
  a `globalTimeout` (20 minutes, or the suite's own measured bound) and ends
  with its 10 slowest tests. `jskit check` fails a webServer that runs the development server
  (`npm run develop`, `vite`), one webServer shared by every worker, and a
  config without a `globalTimeout`.
- A file that truly cannot run beside others, because it holds a resource of
  the whole machine, says why on its first line,
  `// jskit-test: alone - <reason>`. `jskit test` runs it after the others,
  one such file at a time, and fails on a marker without a reason or below the
  first line.

Why: `jskit test` and `testConcurrency()` read one budget, so every runner
uses the machine without starving the other runs on it.

```js
// good: package.json "test": "jskit test", and playwright.config.mjs
import { browserTestConfig } from "@jskit-ai/jskit-catalog/browser-tests";

export default defineConfig(browserTestConfig({ testDir: "./tests/e2e" }));

// bad: "test": "node --test --test-concurrency=1", and
export default defineConfig({ workers: 1, webServer: { command: "npm run develop" } });
```

### Test databases are prepared once

**A test run prepares each database once and restores it from a stored
snapshot of the schema and the rows the migrations write, migration ledger
included, checked by a digest of the migrations.**

- The snapshot is rebuilt only when the digest of the migrations' names and
  contents changes, once and outside the timed tests; every disposable
  database, and every database a test migrated up or down, is restored from
  it. A browser run's fixture seed runs after each restore.
- The full migration history runs once, in its own fresh-schema check
  ([database verification](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/database-layer#verification)).
- The harness reports each preparation phase and its duration, and those
  durations are read, so slow preparation shows instead of hiding inside the
  next test that waits for it.
- The database layer guide's [integration test
  databases](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/database-layer#integration-test-databases)
  gives the snapshot's contents per engine.

Why: an application's migrations include those of every installed package, so
replaying them costs more with each package as well as each migration.

```js
// good: package.json "test": "jskit test --databases"; each file gets a restored copy of TEST_DB_NAME
const { databases } = await prepareTestDatabases({ knexConfig, environment: process.env, count: workers, seed });

// bad: every file replays every migration
before(() => knex.migrate.latest());
```

## Files and layout

### Size limits

**Files stay under 750 lines and functions under 600, in all hand-written
code: server, shared, client (`.vue` and `.js`) and scripts. One concern per
factory.**

- The limit is an outer bound, not a size to aim for: a file near it usually
  holds more than one concern. Split it by concern; never trim lines or join
  statements to fit.

Why: a reader holds one concern at a time; a 2,000-line closure holds ten.

```text
good: invoices.js (list, send), invoiceNumbering.js, invoiceReminders.js
bad:  invoices.js, 1,900 lines: listing, sending, numbering, reminders and PDF rendering
```

### Data modules

**A generated or static data module (a catalogue, a lookup table) is not
code. It is exempt from the size limits, and its first line says it is data
and how it is produced.**

Why: the limits measure code a person reads; a table is scanned, not read.

```js
// good
/* eslint-disable max-lines -- data: the country list, generated by scripts/build-countries.mjs */

// bad: a module of functions excused as data
/* eslint-disable max-lines -- data: invoice helpers */
```

### Formatter

**An application has one formatter config, `formatterConfig(globs)`: width
140, semicolons, double quotes, no trailing commas, one property per line in
an object that spans lines, braces once an `if` spans lines.** `eslint --fix`
applies it.

- A returned frozen result and a `requires`, `optional` or `provides` map put
  each property on its own line. A short leaf literal of at most three scalar
  properties (`{ type: "string", required: true }`) may stay on one line.
- Long prose stays inline in its string or template; never split a sentence
  across `+` to fit the width.

Why: one layout lets a diff show only what changed.

```js
// good
return Object.freeze({
  list,
  send
});

// bad
return Object.freeze({ list, send });
```

### Names

**Factories and action creators are `create*`; a pure value builder is
`build*` or `to*`; a domain operation that creates a thing keeps `create*`
(`createInvoice`). Files are named for what they hold: `<Name>Feature.js`,
`<Name>Provider.js`, `<name>Runtime.js`, `<name>Actions.js`,
`<name>Routes.js`, `types.js`.**

- Sibling factories are named alike (`createInvoiceReads`,
  `createInvoiceWrites`). An error builder keeps its `*Error` suffix.

Why: a name says what a call returns before anyone opens the file.

```js
// good
function buildInvoiceTotals(lines) {

// bad: a pure builder named like a factory
function createInvoiceTotals(lines) {
```

### Comments

**A function's description is a `/** … */` block, with the description
inside it. Comments describe the code, never its history or its tests.**

- A single-factory file puts its description in the factory's JSDoc, not in a
  `//` file header.
- No "was", "now" or "until X is converted", no dead probes, and no shim left
  for a removed option.

Why: a comment that narrates history is wrong the day after it is written.

```js
// good
/**
 * Sends an invoice; a repeated send returns it unchanged.
 * @param {{ invoiceId: string }} input
 */

// bad
// Sends an invoice (moved here from billing.js)
/** @param {{ invoiceId: string }} input */
```

## Checks

### Running the checks

`npm run lint` runs ESLint with `@jskit-ai/config-eslint`, and `npm run
verify` runs `jskit check` (the package graph, navigation and [test
runs](#test-run-rules)), lint, the tests and the build. The foundations'
`eslint.config.mjs` already holds a new
application's code to every check:

```js
import {
  baseConfig,
  clientFeaturesConfig,
  formatterConfig,
  nodeConfig,
  sizeLimitsConfig,
  typedFeaturesConfig,
  vueConfig,
  webConfig
} from "@jskit-ai/config-eslint/server";

const SERVER_SOURCES = ["packages/*/src/server/**", "packages/*/src/shared/**", "server/**", "server.js"];
const CLIENT_SOURCES = ["packages/*/src/client/**", "src/**"];
const HAND_WRITTEN_SOURCES = ["packages/*/src/**", "src/**", "config/**", "server/**", "server.js", "bin/**"];

export default [
  ...baseConfig,
  ...typedFeaturesConfig(SERVER_SOURCES),
  ...sizeLimitsConfig(HAND_WRITTEN_SOURCES),
  ...vueConfig,
  ...clientFeaturesConfig(CLIENT_SOURCES),
  ...webConfig,
  ...nodeConfig,
  ...formatterConfig([...SERVER_SOURCES, "config/**", "bin/**"])
];
```

- `typedFeaturesConfig(globs)` makes every `jskit/*` rule and the size limits
  errors for the server and shared code the globs select (tests and client
  directories excluded).
- `sizeLimitsConfig(globs)` holds the rest of the hand-written code, client
  code included, to the size limits.
- `formatterConfig(globs)` is the formatter.
- `baseConfig` reports the `jskit/*` rules as warnings on any
  `**/src/server/**`, so an existing application sees them before it lists a
  package; it lists each package as it converts it.
- `clientFeaturesConfig(globs)` holds client code to the same rules; see
  [client features](client-features.md#running-the-checks).

Every finding ends with a link to the section of this page that explains it.

### Lint rules

| Rule | Reports | Section |
| --- | --- | --- |
| `jskit/typed-dependencies` | a factory or constructor that receives collaborators without a JSDoc `@param` type | [Typed collaborators](#typed-collaborators) |
| `jskit/required-collaborators` | an absent default on a collaborator, a `typeof … === "function"` probe, an optional call (`x.y?.()`, `received?.()`, `receivedService?.y()`) | [Required collaborators](#required-collaborators) |
| `jskit/no-dual-shape` | a value accepted in two shapes, `x.service \|\| x` or `x?.value ?? x` | [One shape per value](#one-shape-per-value) |
| `jskit/no-env-default` | `env = process.env`, `env \|\| process.env`, `env ?? process.env` | [Environment from the caller](#environment-from-the-caller) |
| `jskit/no-slot-setter` | a `set<Name>()` that fills a slot after construction | [Optional tokens](#optional-tokens) |
| `jskit/no-module-registry` | a module-level `register<Name>()` that writes module state | [Owned state](#owned-state) |
| `jskit/named-repeated-type` | a `ReturnType<…>` or `X["y"]` JSDoc type written in two or more files of a package | [Capability types](#capability-types) |
| `jskit/action-creator` | an action definition outside a `create<Name>Actions` creator, or a creator that takes its capabilities positionally | [Action creators](#action-creators) |
| `jskit/action-execute-shape` | an `execute` that is not one arrow making one call: a body, `execute: helper(…)`, a built result | [One-line execute](#one-line-execute) |
| `jskit/one-line-action` | `input = {}`, `input \|\| {}` or `input?.` in an action, an `async` `execute`, an unfrozen definition or list | [One-line execute](#one-line-execute) |
| `jskit/no-idempotency` | an `idempotency` field on an action definition or its shared-field constant | [No idempotency](#no-idempotency) |
| `jskit/no-optional-after-default` | `options?.` or a second `options \|\| {}` on a parameter that has a default | [Options and defaults](#options-and-defaults) |
| `jskit/frozen-factory-result` | a `create*` result that is not frozen, or a member defined inline in it | [Frozen results](#frozen-results) |
| `jskit/no-factory-spread` | a `create*()` result spread into a factory's API or a token value | [Named members](#named-members) |
| `jskit/no-duplicate-helper` | a small helper, function or arrow, repeated in another file of the package | [One helper per package](#one-helper-per-package) |
| `jskit/app-error-code` | an `AppError`, `DomainError`, `ConflictError` or `NotFoundError` (or a subclass the module declares) without its own code, and one code naming two sentences in a module | [Refusals carry their own code](#refusals-carry-their-own-code) |
| `jskit/no-patched-error` | `Object.assign(new Error(…), { statusCode })`, or an error builder's result given its status afterwards | [One construction per error](#one-construction-per-error) |
| `jskit/no-test-only-export` | an export whose name says only tests use it (`…ForTests`, `__reset…`; `__testables` aside) | [No test-only exports](#no-test-only-exports) |
| `jskit/one-property-per-line` | two properties on one line in a returned `Object.freeze({ … })` or a `requires` / `optional` / `provides` map (`eslint --fix` splits them) | [Formatter](#formatter) |
| `jskit/jsdoc-description-inside` | a `//` description directly above a `/** */` block | [Comments](#comments) |
| `jskit/allow-comment-form` | a `readable-check: allow` reason without a prefix from the table below, or one that cites tests or the state of a project | [Exceptions](#exceptions) |
| `max-lines`, `max-lines-per-function` | files over 750 lines, functions over 600 | [Size limits](#size-limits) |

### Test-run rules

`jskit check` reports these in every package script, and in the Playwright
and Vitest configs those scripts use. No comment excuses them; a test file
that must run alone says so on its own first line instead.

| Rule | Reports | Section |
| --- | --- | --- |
| `test/node-test` | a script that runs `node --test` directly instead of `jskit test` | [Test files run in parallel](#test-files-run-in-parallel) |
| `test/fixed-concurrency` | `--test-concurrency` in a script, or a script that pins `V64_TEST_CONCURRENCY` or `PLAYWRIGHT_WORKERS` | [Test files run in parallel](#test-files-run-in-parallel) |
| `test/playwright-workers` | `--workers` or `-j` passed to `playwright test`, its config without `workers: testConcurrency()` or `browserTestConfig()`, or with `workers` set over `browserTestConfig()`'s | [Test files run in parallel](#test-files-run-in-parallel) |
| `test/playwright-dev-server` | a Playwright webServer command that runs the development server (`npm run develop`, `npm run dev`, `bin/develop.js`, `vite`, `vite dev`) | [Test files run in parallel](#test-files-run-in-parallel) |
| `test/playwright-isolation` | a Playwright webServer every worker shares, without `browserTestConfig()` | [Test files run in parallel](#test-files-run-in-parallel) |
| `test/playwright-global-timeout` | a Playwright config without a `globalTimeout` (or `browserTestConfig()`), or with `globalTimeout: 0` | [Test files run in parallel](#test-files-run-in-parallel) |
| `test/vitest-workers` | `--maxWorkers`, `--minWorkers` or `--no-file-parallelism` passed to Vitest, or its config without `maxWorkers: testConcurrency()` or with `fileParallelism: false` | [Test files run in parallel](#test-files-run-in-parallel) |

The rules see shapes, not intent. Feature files, owned state beyond
registries, shutdown, loggers, shared action fields, strict inputs, the action
policy, request context, validated input, one reader per fact, routes,
internal failures, swallowed failures, test doubles, tests as callers, data
modules and names are checked by reading.

### Exceptions

A justified exception carries a comment on the line before it, naming the
rule or the finding, with a reason that says what is true of the code, never
the state of a project or its tests:

```js
// readable-check: allow method-probe - input validation: an application supplies the serializer builder
if (typeof buildSerializer !== "function") {
```

| Reason prefix | The exception |
| --- | --- |
| `input validation:` | a public library entry point checks a value an application passes it, and refuses a wrong one with its own error |
| `data:` | probes or defaults data (a route definition, a transport, a parsed record, an options list), not a collaborator; it never excuses a function itself, such as a repeated helper |
| `platform object:` | probes a host or library object reached internally, such as `Headers`, a fetch `Response` or a Knex transaction (`platform object: a Knex transaction`) |
| `optional operation:` | calls a contract method that some real implementer lacks, which the contract marks optional |
| `safety invariant: <what goes wrong>` | keeps a guard that protects an internal invariant, saying what goes wrong without it; the retired `test asserts error:` is reported |
| `not a slot:` | matched a name that fills no slot |
| `cycle: <supplier> requires <owner>` | keeps a setter because the slot's supplier requires its owner |
| `deferred until boot: <reason>` | keeps a capability handed out at setup and filled in `boot()`, such as the deferred `auth.service`: a two-phase value that is neither a cycle nor a setter |
| `filled by <repository>; convert with its supplier` | keeps a setter that another repository's code calls |
| `cross-repository slot <token>` | keeps a probe for a token another repository supplies |
| `shared resource:` | keeps client module state that every instance on the page shares on purpose ([client features](client-features.md#module-state)) |

One kind of probe gets one prefix and one wording everywhere, and a bare
`typeof x` guard of that kind carries the same comment even where no rule
reports it. The size limits are ESLint's own rules: excuse them with
`// eslint-disable-next-line max-lines-per-function -- <reason>`, or a data
module's header.

## A whole feature

The `server/feature-package` pattern is a complete feature that passes every
check. Its layout:

```text
packages/booking-engine/
  package.json                  exports ./server/types; lists the capability it provides
  src/server/
    types.js                    BookingEngine, BookingEngineAvailability
    BookingEngineFeature.js     optional slot, provided engine, setup, actions
    bookingEngine.js            createBookingEngine({ availability }): frozen named functions
    bookingAvailability.js      everyScopeOpen, the slot's named default
    bookingEngineActions.js     BOOKING_QUERY and createBookingEngineActions({ bookingEngine })
    inputSchemas.js             the actions' input validators
```

Following a call takes one step each time: a route names
`ACTION_GET_STATUS`; that action's `execute` calls `bookingEngine.readStatus`;
`BookingEngine` is `ReturnType<typeof createBookingEngine>`, so the call
reaches `bookingEngine.js`.
