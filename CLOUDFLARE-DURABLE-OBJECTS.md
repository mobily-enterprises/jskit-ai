# Durable Objects for JSKIT-generated apps — exploration notes

Recorded: 2026-10-18. Status: **parked, to revisit**. Nothing here is implemented.
This is a transcript-level record of a design conversation, so the reasoning and
evidence survive until we pick it up again. Treat every proposed API in this file
as a sketch, not a contract.

## Why we are looking at this

The question is not about Vibe64 itself (which has no database). It is about the
**applications Vibe64 generates with JSKIT**: could app authors (and the agents
writing apps for them) store data as Cloudflare-style Durable Objects, where every
entity — a user, workspace, board, document, room — has its own private SQLite
database?

The attraction: it is a *naturally sharded* system. You choose the shard key when
you choose the object ID, each shard is small and isolated, there is no central
database server to scale, and idle shards cost almost nothing. Cloudflare markets
this as "millions of databases"; the number of objects is effectively unbounded.

## The Cloudflare primitives (as understood on 2026-10-18)

### Durable Objects with SQLite storage

- SQLite-backed Durable Objects became generally available in April 2025 and are
  the default storage backend for new Durable Object classes.
- Each object has a globally unique ID (e.g. derived from `board:b_7f3`). Exactly
  one live instance of that object exists in the world at a time.
- Each object has its own embedded SQLite database, accessed synchronously from the
  same thread as the object's code (`ctx.storage.sql.exec(...)`). This makes
  queries very fast (no network hop).
- Storage limit is 10 GB per object.
- Requests to one object run one at a time (single-threaded actor), giving strong
  consistency without locks. Cloudflare's "input/output gates" protect against
  interleaving surprises around storage.
- Objects are created near whoever first touches them, and hibernate when idle.
  WebSockets can stay connected while the object hibernates.
- Point-in-time recovery for 30 days.
- Transactions use `ctx.storage.transactionSync(...)` /
  `ctx.storage.transaction(...)`. To our understanding, raw `BEGIN`/`COMMIT`
  statements are not allowed through `sql.exec()`. **Verify before relying on
  this.**
- Alarms give each object its own scheduled wakeups.

### D1

- Cloudflare's hosted SQLite database product, built on the same Durable Object
  machinery. 10 GB per database.
- In this design D1 plays the role of the **directory** (the "master index").

### Trade-offs of the model

- **No cross-object queries.** "Count all users" or "search every card" means
  visiting every object, or maintaining an index elsewhere.
- **Per-object throughput ceiling.** One object is single-threaded; roughly
  hundreds to low thousands of requests per second. A bad shard key (one global
  counter) becomes a hot spot.
- **Schema migration is per object.** The usual pattern is lazy: each object
  migrates itself when it wakes, so different objects can be on different schema
  versions at the same moment.
- **Lock-in**, historically — code only ran on Cloudflare. See the celld section:
  this is changing.

## The "master index" (directory) pattern

Durable Objects give you no built-in "list all objects" query. You build the
directory yourself. Options discussed:

1. **D1 as the directory (chosen).** A normal table (`users`, `tenants`, `boards`)
   with each entity's ID, metadata and the object it lives in. Used for listing,
   search and admin screens.
2. A dedicated index Durable Object (or several, sharded by prefix/hash). Keeps
   everything in one consistency model.
3. An analytics copy: objects emit events to Queues / Analytics Engine / R2 for
   cross-everything reporting queries.

Points to get right:

- **Source of truth:** usually the per-entity object. The directory row is a
  derived summary that may lag slightly.
- **Sync:** the object commits locally first, then updates the directory —
  ideally through a queue with retries (`waitUntil` at minimum), plus a periodic
  reconciliation sweep to repair drift.
- **Creation goes through the directory:** "create board" starts at the directory,
  which enforces uniqueness and assigns the ID, then the object is woken and
  initialises itself.

This is the same shape as Vibe64 Online's own workspace registry: a small central
list pointing at large isolated shards.

## Fit for generated apps

Why it suits Vibe64-generated apps:

- Scale comes from the design: the agent chooses the shard key once.
- Local development is realistic: `wrangler dev` / Miniflare / `workerd` run
  Durable Objects and D1 locally without a Cloudflare account. Preview could run
  the real thing; only Deploy needs an account.
- Cheap hosting for many small apps (idle objects are nearly free).
- Familiar to people coming from Lovable, which publishes to Cloudflare
  (see Vibe64 Online `docs/_old/research/vibe64-vs-lovable.md`).

The real risk: it only pays off for apps that shard naturally — collaborative
documents, chat, multi-tenant SaaS, per-user data. A classic admin app full of
"query everything" reports fights the model. Stack guidance must teach the agent
*when* to choose it, not make it the default.

Deployment would need its own Vibe64 Deploy contract (`wrangler deploy`) using the
**user's** Cloudflare account and API token — secrets and billing are theirs.

## JSKIT today (evidence from the code, 2026-10-18)

### Server data layer

`packages/agent-docs/guide/agent/app-setup/database-layer.md`: JSKIT applications
use Knex through exactly one selected driver package —
`@jskit-ai/database-runtime-mysql` or `@jskit-ai/database-runtime-postgres` — both
built on `@jskit-ai/database-runtime`. Migrations are Knex migrations discovered
from the installed package graph.

A D1 / SQLite driver would fit this seam as a new `database-runtime-*` package
(Knex has no built-in D1 dialect, so one would be needed). That covers the
**directory**. Per-entity databases do *not* fit as "just a driver", because they
change *where a record lives*: you need the shard key before you can query.

### UI packages — the part we feared losing

Checked the dependencies and imports of the `*-web` packages (`auth-web`,
`connectors-web`, `console-web`, `http-web`, `payments-web`, `rewarded-web`,
`shell-web`, `uploads-image-web`, `users-web`, `workspaces-web`):

- They depend on client and shared code only: `kernel/shared/...`,
  `shell-web/client/...`, `http-runtime/client`, `resource-crud-core/shared/...`,
  `workspaces-core/shared/jsonApiTransports`, `auth-core/shared/...`.
- They talk to the server over the HTTP / JSON:API contract (`useView`,
  `useCommand`, JSON:API transports). They do not care whether the server is
  Node + Knex or something else, as long as the contract is the same.
- `workspaces-core/shared/support/workspacePathModel` already puts the workspace
  in the URL — which is exactly the shard key a Workspace object would use.
- Small exception to look at: a few web files import
  `@jskit-ai/auth-core/server/devAuth`.

| Layer | Fate under a Durable Objects backend |
|---|---|
| UI (shell, CRUD UI, users, workspaces, uploads) | **Survives**, if the backend keeps the HTTP contract |
| Shared (kernel, paths, capabilities, JSON:API transports) | **Survives** — plain JS, runs anywhere |
| Server (HTTP runtime, Knex `database-runtime-*`, auth server) | **Adapted** — runs inside `workerd`, or reimplemented over Durable Objects behind the same routes |

Conclusion: the realistic risk is losing *part of the server side*, not the UI
work. If JSKIT's server runs inside `workerd` with Node compatibility (unverified),
much of the server survives too.

## json-rest-api (evidence from `/home/merc/Development/current/json-rest-api`)

Findings, at commit `f4a23a9`:

- SQLite through `better-sqlite3` is already a verified backend
  (`docs/GUIDE/30-backend-capabilities.md`).
- The storage contract *is* Knex: `StorageQuery` and `StorageDatabase` in
  `plugins/core/lib/storage/storage-types.d.ts` are Knex types.
  `rest-api-knex-plugin.js` maps resources to ordinary tables;
  `rest-api-anyapi-knex-plugin.js` maps them to canonical records. Both use
  native Knex queries and the common storage interfaces under
  `plugins/core/lib/storage/`.
- AnyAPI already carries a `tenantId` option and stamps it on records
  (`plugins/core/rest-api-anyapi-knex-plugin.js`) — a ready-made shard key concept.
- The library does not ship a remote-service / NoSQL CRUD backend.
- `api.transaction` hands out a real Knex transaction; the library owns completion
  hooks and transaction outcomes (`lib/error-context.js`,
  `lib/knex-transaction.js`).
- The guide warns that SQLite "concurrent writers can fail with busy/snapshot
  conflicts". Inside one Durable Object requests run one at a time, so that failure
  mode disappears.

### Possible integration

- A custom Knex client that compiles with Knex's SQLite dialect and executes via
  `ctx.storage.sql.exec()` (and against D1 for the directory).
- One json-rest-api instance per object, over that object's SQLite. A thin Worker
  routes `/api/...` to the right object.

Hard parts:

- **Transactions:** mapping Knex transactions plus json-rest-api's completion hooks
  and outcome tracking onto `transactionSync`. The one piece needing real design.
- **Sync vs async:** object SQL is synchronous, Knex is promise-based. Easy to wrap;
  check that nothing assumes separate connections (positioning uses
  separate-connection coordinator rows).
- **No cross-shard queries:** relationships, includes and filters work only inside
  one object.
- **Verification:** a new backend needs its own capability-matrix row and real
  tests on `workerd`/Miniflare. Passing `better-sqlite3` tests is not evidence.

## Should json-rest-api hide Durable Objects?

Verdict reached: **hide the storage, not the shard boundary.**

Works well hidden: everything *inside* one object — resources, relationships,
filters, includes, pagination, hooks over that object's SQLite. Authors keep the
familiar CRUD model.

Breaks if hidden:

- **Which object** must be explicit in every request (route parameter or call
  context). Pretending there is one big database makes cross-object relationships
  look possible when they are not.
- **Cross-object joins** are impossible; cross-shard references are plain IDs.
- **Non-CRUD features** — realtime fan-out, alarms, atomic methods — are the point
  of Durable Objects and do not map onto REST resources.
- **Transactions** are limited to one object; must be enforced, not assumed.

Direction: generalise AnyAPI's `tenantId` into a first-class shard concept.

- Resources declare a home (`directory` or an object class such as `Board`).
- The shard comes from the request.
- Cross-shard references are IDs only; json-rest-api refuses to include or filter
  across them with a clear error.
- Escape hatch: custom object methods for atomic and realtime work.

## Worked example (proposed API, Trello-like app)

### Resource definitions

```js
// Directory resources: live in D1, visible across all boards
await api.addResource('users', {
  home: 'directory',
  schema: { name: { type: 'string', required: true }, email: { type: 'string', required: true } }
})

await api.addResource('boards', {
  home: 'directory',
  shardRoot: 'Board',            // each board row owns a Board object
  schema: {
    title:     { type: 'string', required: true, search: true },
    owner_id:  { type: 'id', belongsTo: 'users', as: 'owner' },
    cardCount: { type: 'number', default: 0 },   // summary, written by the object
    updatedAt: { type: 'dateTime' }
  }
})

// Board-shard resources: live inside one Board object's SQLite
await api.addResource('lists', {
  home: 'Board',
  schema: { title: { type: 'string', required: true }, position: { type: 'number' } },
  relationships: { cards: { type: 'hasMany', target: 'cards', foreignKey: 'list_id' } }
})

await api.addResource('cards', {
  home: 'Board',
  schema: {
    title:       { type: 'string', required: true, search: true },
    list_id:     { type: 'id', belongsTo: 'lists', as: 'list' },
    assignee_id: { type: 'id', crossShard: 'users' }   // plain ID; never joined
  },
  directorySummary: { boards: ({ count }) => ({ cardCount: count('cards'), updatedAt: new Date() }) }
})
```

Rule for the agent: if it belongs to one board, its home is `Board`. If it must be
listed or searched across boards, its home is the directory.

### Calls and what happens in the backend

**Create a board** — `POST /api/boards` `{ "title": "Launch plan" }`

1. The Worker sees `boards` lives in the directory and runs against D1.
2. json-rest-api inserts the row and assigns `id = "b_7f3"`.
3. Because `boards` is a `shardRoot`, Board object `b_7f3` is woken; its empty
   SQLite runs migrations to create `lists` and `cards`. Locally that is
   `data/objects/Board/b_7f3.sqlite`.
4. Response `201 { "id": "b_7f3", "title": "Launch plan", "cardCount": 0 }`.

**List my boards** — `GET /api/boards?filters[owner]=u_12&sort=-updatedAt`

D1 only. No Board object wakes. This is why the directory exists.

**Add a card** — `POST /api/boards/b_7f3/cards`
`{ "title": "Write press release", "list": "l_1", "assignee": "u_44" }`

1. The Worker reads the shard from the URL and forwards to object `b_7f3`.
2. Inside the object json-rest-api runs normally: validation, hooks, `INSERT` into
   its own SQLite inside `transactionSync`. `list_id` is checked locally;
   `assignee_id` is stored as-is (another shard).
3. After commit: the directory summary goes out in the background (`waitUntil` or
   a queue with retries) setting `boards.b_7f3.cardCount = 13`, and a realtime
   event goes to WebSocket clients connected to this board.
4. Response `201 { "id": "c_901", ... }` without waiting for the directory.

**Read a board with everything** —
`GET /api/boards/b_7f3/lists?include=cards&sort=position`

Entirely inside object `b_7f3`: ordinary SQL, one round trip, no network joins.

**Cross-shard include (refused)** — `GET /api/boards/b_7f3/cards?include=assignee`

→ `400 { "error": "CROSS_SHARD_INCLUDE", "detail": "cards.assignee points to directory resource 'users'; fetch it separately" }`

Client instead batches: `GET /api/users?filters[id]=u_44,u_51`. The refusal is
deliberate — silent cross-object joins are what destroy scaling.

**Global search (refused)** — `GET /api/cards?filters[titleContains]=press`

→ `400 SHARD_REQUIRED`. If the app genuinely needs global card search, add a
summary/search index to the directory or a search service; never fan out.

**Atomic action**

```js
api.addShardMethod('Board', 'moveCard', ({ sql, input }) => {
  // runs inside transactionSync; calls are handled one at a time per board, so no races
  sql`UPDATE cards SET list_id = ${input.toList}, position = ${input.position} WHERE id = ${input.cardId}`
  sql`UPDATE cards SET position = position + 1 WHERE list_id = ${input.toList} AND position >= ${input.position} AND id != ${input.cardId}`
})
```

`POST /api/boards/b_7f3/actions/moveCard`
`{ "cardId": "c_901", "toList": "l_2", "position": 0 }` — two users dragging at the
same moment are simply handled one after another.

**Realtime** — `GET /api/boards/b_7f3/live` (WebSocket upgrade) connects straight to
object `b_7f3`; each write pushes `{ type: "cards", id: "c_901", op: "update" }`.
On Cloudflare idle sockets let the object hibernate.

**Scheduled work** —
`api.addShardAlarm('Board', 'dueReminders', { every: '1h' }, ({ sql }) => { ... })`
gives each board its own timer instead of a global cron scanning all boards.

### Same app, two runtimes

| | Local / Preview (Node) | Cloudflare |
|---|---|---|
| Directory | `data/directory.sqlite` | D1 |
| Board `b_7f3` | `data/objects/Board/b_7f3.sqlite`, with a queue per ID | Durable Object `Board` with ID `b_7f3` |
| One call at a time per board | an in-process queue per ID | built into the platform |
| Directory updates | in-process after commit | `waitUntil` / Queues |
| Realtime | the app's WebSocket server | hibernating Durable Object WebSockets |

## The direct "object" programming model (alternative framing)

We also sketched letting authors define objects directly, with json-rest-api as an
optional convenience inside them:

```js
// server/objects/Board.js
export default defineObject({
  name: 'Board',
  migrations: [
    `CREATE TABLE cards (id TEXT PRIMARY KEY, title TEXT, position REAL)`
  ],
  methods: {
    addCard({ title }) {
      const id = crypto.randomUUID()
      this.sql`INSERT INTO cards (id, title, position) VALUES (${id}, ${title}, 0)`
      this.directory.touch({ updatedAt: Date.now() })
      return { id }
    },
    listCards() {
      return this.sql`SELECT * FROM cards ORDER BY position`
    }
  }
})

const board = objects.Board.get(boardId)
await board.addCard({ title: 'Ship it' })
```

Portability principle (JSKIT rule: standalone defaults work without any host):
JSKIT defines the contract and does not import Cloudflare. A local runtime (one
SQLite file per object, per-ID serialisation, SQLite directory) has **equal
standing** with the Cloudflare runtime, not just a dev stand-in.

## Existing layers built for this

- **RivetKit / Rivet Actors** — closest independent match. Actors keyed by ID with
  their own state and, since February 2026, their own SQLite. Single-threaded,
  sleep when idle, realtime events, scheduling, actions. Runs on Node.js, Bun or
  Rust, self-hosted or on their cloud. Claims an S3-tiered SQLite storage engine
  that avoids the 10 GB cap (vendor claim, unverified). Historically had a
  Cloudflare Workers driver; current status unconfirmed.
- **Cloudflare Agents SDK** (`agents`) — Durable Object based class with
  `this.sql`, state sync to clients, scheduling, WebSockets. Aimed at AI agents,
  usable generally. Cloudflare-only.
- **PartyServer / PartyKit** (Cloudflare acquired PartyKit) — rooms on Durable
  Objects for realtime/collaboration. Cloudflare-only.
- A beta `@cloudflare/actors` library was recalled but **could not be confirmed**.
- Ancestors / neighbours: Orleans (.NET virtual actors), Akka; LiveStore and
  TinyBase (per-store SQLite with sync, can use Durable Objects as backend,
  client-focused); Turso/libSQL (database-per-tenant without actors).

## The Deno acquisition and celld — why this changed the plan

News (secondary coverage, early October 2026; sources disagree slightly on the
date, 9 or 10 October):

- Cloudflare acquired Deno. Ryan Dahl and the Deno team join to work on Workers.
- The deal centres on **celld**, released by Deno in August 2026: an Apache-2.0
  Rust binary that self-hosts Workers **and Durable Objects** using V8, SQLite, LTX
  and Tokio. Multiple instances share one S3-compatible bucket, which handles
  placement and routing.
- Cloudflare plans to merge celld into the open-source `workerd` as a supported
  self-hosting path. **No firm date.**
- `workerd` already runs Durable Objects with SQLite, but single-instance only —
  fine for local/Preview, not for scale. celld closes that gap.
- Deno runtime: monthly bug-fix/security releases for one year, active development
  ending around October 2027. Deno Deploy reportedly shuts down within six months.
- celld caveats: no TLS on peer-to-peer traffic (private network / WireGuard
  recommended); Worker projects need esbuild on PATH; performance figures come from
  secondary coverage and are unverified.

Related: since 2026-08-04 compatibility dates, Workers enable `nodejs_compat` by
default (`node:crypto`, `node:buffer`, `node:stream`, `node:net`, `node:dns`,
`node:fs`, `node:http`, …). Some APIs are only partially implemented; Wrangler
polyfills for unsupported modules no-op or throw.

### Revised recommendation

Target the **Durable Objects API itself** as the contract, rather than RivetKit's
API. It is becoming an open standard and runs in three places:

| Where | Runtime |
|---|---|
| Preview / local | `workerd` (single instance, works today) |
| Self-hosted at scale | celld now, merged `workerd` later |
| Hosted | Cloudflare |

The JSKIT layer then becomes thin — a package that, inside a Durable Object,
provides json-rest-api resources for that shard, the D1/SQLite directory pattern
with background summary updates, `addShardMethod`/realtime/alarm wrappers over
native Durable Object features, and Vue client helpers that know a shard appears
in every URL. RivetKit stays a fallback if the Cloudflare/celld path stalls.

## What waits and what does not

- **Waits:** self-hosting at scale (many objects across our own VPSes) — depends on
  celld maturing (inter-node TLS, stability) or its merge into `workerd`.
- **Available today:** `workerd` locally (enough for Preview/dev) and Cloudflare
  itself (Durable Objects with SQLite, D1, Node compatibility — all production).

## Open questions

1. Does JSKIT's server (HTTP runtime, kernel server providers, json-rest-api) start
   inside `workerd` with default Node compatibility? This decides "JSKIT storage
   option" versus "JSKIT server variant".
2. Can one JSKIT workspace map to one Durable Object with the existing workspace
   routes (`workspacePathModel`) unchanged?
3. Does the existing UI work against that backend unmodified?
4. How do Knex transactions and json-rest-api completion hooks map onto
   `transactionSync`? Is raw `BEGIN` really rejected by `sql.exec()`?
5. What happens to features that assume one global database: auth/sessions,
   users-core, payments, uploads, positioning's coordinator rows?
6. Why do some `*-web` files import `auth-core/server/devAuth`?
7. Directory sync guarantees: `waitUntil` vs Queues vs reconciliation sweep.
8. Per-object schema migration story for JSKIT migrations (lazy on wake).
9. celld maturity and the actual `workerd` merge timeline.
10. Vibe64 side: a Stack component and a Deploy contract using the user's own
    Cloudflare account; Colleague usage docs for both.

## Proposed spike (when we revisit)

In a scratch directory, not in this repository:

1. Run a minimal JSKIT server plus json-rest-api inside `workerd` locally.
2. One `Workspace` (or `Board`) Durable Object, with a custom Knex client over
   `ctx.storage.sql.exec()`.
3. A few CRUD calls, one include, one transaction, one cross-shard refusal.
4. Point the existing JSKIT UI at it and see what breaks.

If 1–3 pass, this becomes "JSKIT gains a Cloudflare server runtime", not "abandon
JSKIT". Estimate after the spike: a week versus a quarter.

## Comparison with Next.js, and rendering scope

### Is JSKIT more comprehensive than Next.js?

They are different kinds of framework. Next.js is a rendering and routing
framework; it deliberately leaves auth, database, users, teams and payments to
third-party libraries. JSKIT ships application building blocks: auth
(`auth-core`, `auth-web`, local and Supabase providers), users, workspaces, CRUD
with a UI generator, uploads, payments, console/admin, connectors, assistant/AI,
realtime, mobile through Capacitor, and agent docs/patterns. That makes it closer
to Laravel, Rails, Wasp or RedwoodJS than to Next.js, and already broader for
building complete apps.

The Durable Objects layer, once built, would add a self-sharding data model and
portable hosting (local, celld, Cloudflare) that Next.js has no equivalent for.

Next.js is far ahead on rendering (server components, streaming, static and
incremental generation, edge middleware, image optimisation), maturity, ecosystem
size and hosting support (Vercel; Cloudflare through OpenNext).

Summary: JSKIT is more batteries-included for full apps; Next.js is more mature and
wider-reaching as a web framework. For Vibe64 that is the right trade-off — the
agent benefits more from consistent built-in app features than from a giant
ecosystem it has to assemble.

### Should JSKIT cover Next.js-style rendering?

Current state (checked 2026-10-18): JSKIT has no server-side rendering. A search
for SSR terms found only built bundles and tests. It is a client-rendered Vite +
Vue application, and `genesis/blueprint.md` describes "authenticated user and
workspace experiences". Behind a login, most Next.js rendering features buy very
little.

| Feature | Should JSKIT cover it? | Why |
|---|---|---|
| Server components | **No** | React-specific model with no direct Vue equivalent; huge complexity for little gain in logged-in apps. |
| Streaming SSR | **No** | Matters for content-heavy public pages, not dashboards. |
| Incremental static regeneration | **No** | A caching/hosting feature for content sites; the CDN can handle it. |
| Edge middleware | **Comes for free** | On Cloudflare, the Worker in front of the Durable Objects is the edge middleware (auth checks, routing by shard). |
| Static prerendering of public pages | **Yes, small** | Landing, pricing and docs pages need SEO and fast first paint. Prerender those few routes at build time; the app stays a single-page app. |
| Image optimisation | **Yes, small** | Resize/convert on upload (`uploads-image-web` already uses Uppy's compressor) plus responsive `srcset`; Cloudflare Images when deployed there. |

Principle: JSKIT should be excellent at **apps**. For **content sites**, either
prerender a few public routes or let the project use a purpose-built tool (Nuxt,
Astro, VitePress) alongside the app. Rebuilding Next.js's rendering engine would be
a lot of complexity aimed at something JSKIT apps rarely need. If full Vue SSR is
ever genuinely required, integrate with Nuxt rather than reinvent it — but do not
start there.

## Sources

- [Cloudflare acquires Deno — Linuxiac](https://linuxiac.com/cloudflare-acquires-deno-javascript-runtime-core-development-to-end-in-2027/)
- [Cloudflare to discontinue Deno runtime — heise](https://www.heise.de/en/news/Cloudflare-to-discontinue-Deno-runtime-Open-source-community-to-take-over-11487398.html)
- [Cloudflare acquires Deno — Quartz](https://qz.com/cloudflare-acquiring-deno-workers-platform-101226)
- [Cloudflare Bought Deno. You Have 12 Months — DEV](https://dev.to/max_quimby/cloudflare-bought-deno-you-have-12-months-13ie)
- [Cloudflare acquires Deno to expand Workers self-hosting with celld — DEV](https://dev.to/techpulse01239/cloudflare-acquires-deno-to-expand-workers-self-hosting-with-celld-2m1d)
- [Celld: self-hosted Durable Objects and Workers using S3 and SQLite — daily.dev](https://daily.dev/posts/celld-self-hosted-durable-objects-and-workers-using-s3-and-sqlite-vglsddxk2)
- [Cloudflare plans to merge celld into workerd — TechFlow](https://www.techflowpost.com/en-US/article/34497)
- [Self-hosting Workers: what celld and the Deno deal actually run — Groundy](https://groundy.com/articles/self-hosting-cloudflare-workers-what-celld-and-the-deno-deal-actually-run/)
- [Deno celld: self-host Durable Objects — byteiota](https://byteiota.com/deno-celld-self-hosted-durable-objects/)
- [celld frees Durable Objects from Cloudflare — XenoSpectrum](https://xenospectrum.com/en/celld-durable-objects-self-hosted/)
- [Durable Objects without Cloudflare — Reptile Haus](https://reptile.haus/journal/celld-self-hosted-durable-objects-architecture-2026/)
- [Node.js compatibility enabled by default — Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/)
- [Workers Node.js compatibility](https://developers.cloudflare.com/workers/platform/nodejs-compatibility/)
- [Rivet GitHub](https://github.com/rivet-dev/rivet)
- [Introducing SQLite for Rivet Actors](https://rivet.dev/changelog/2026-02-26-sqlite-for-rivet-actors/)
- [SQLite storage for Rivet Actors](https://rivet.dev/actors/docs/sqlite/)
- [Zero-disk S3-tiered SQLite engine — Rivet](https://rivet.dev/blog/2026-07-31-how-we-built-the-first-zero-disk-s3-tiered-storage-engine-for-sqlite/)
