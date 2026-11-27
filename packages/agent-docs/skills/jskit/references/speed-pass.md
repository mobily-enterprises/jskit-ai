<!-- Generated from `packages/agent-docs/site/guide/framework/speed-pass.md`. -->

# Speed pass

A speed pass makes an app take the time its work needs.
Genesis's speed pass skill (`genesis-speed-pass`) holds the method: measure
each wait first on a realistic build at realistic sizes, fix its cause, measure
again the same way, and never raise a time limit, add retries, or shrink
realistic data or coverage to get faster. This page says where each wait lives
in a JSKIT app and which JSKIT tools measure and fix it. The rules it applies
are already in [Typed features](typed-features.md),
[Client features](client-features.md),
[Data access](data-access.md) and the
[sanity checks](sanity-checks.md). Query counts, narrowing and
indexes belong to the [data pass](data-pass.md): when a wait is
database time, apply that page to the path. The test suite's time belongs to
the [test pass](test-pass.md).

## Client speed

### Measure

- Build with `npm run build` and read Vite's report: every chunk with its
  size and its gzip size. `dist/index.html` names the entry script and the
  chunks it preloads (`<link rel="modulepreload">`): together they are the
  JavaScript every page loads before it shows anything. Vite's warning about
  a chunk over 500 kB is a finding to follow to its import, never a limit to
  raise with `build.chunkSizeWarningLimit`.
- Serve that build and open each main screen with a cold cache. In a
  Playwright spec, `page.on("request", ...)` counts the `/api` requests a
  screen or an action makes; look for the same request twice, one request per
  row, and requests made on a timer.

### Fix

- **Screens load with their routes.** A page under `src/pages` loads as its
  own chunk when its route is first visited. A library one page uses is
  imported by that page or a component it shows, never by `src/main.js`, a
  client provider or a layout every page renders. A heavy component that a
  page shows only sometimes loads with
  `defineAsyncComponent(() => import("./HeavyChart.vue"))`.
- **Packages keep their screens out of every page.** Each client provider is
  exported by a subpath of its own, and its file imports only what every page
  needs ([Provider subpaths](client-features.md#provider-subpaths)).
  A provider without one, or a `./client` that declares `routeComponents` or
  `clientRoutes` or uses `export *`, brings all of `./client` to every page.
  On the accounts starter, loading users-web's provider through its subpath
  instead of all of its `./client` took the JavaScript a page loads before it
  starts from 1,302 KB to 778 KB.
- **One request for related records.** A list shows its related records with
  `include` and the including contract's `includeFields`, in the same request,
  never with a request per row; `fields[<type>]` narrows what an included
  record carries ([Layer 2: the CRUD surface](data-access.md#layer-2-the-crud-surface)).
  A picker reads its selected values past the loaded page by id, all in one
  request (`filter[id]`, which `useCrudListFilterLookups()` sends for a lookup
  filter), and searches on the server with `q`
  ([Wire list search with the initial resource](crud-operations.md#wire-list-search-with-the-initial-resource),
  [Search on the server](client-features.md#search-on-the-server)).
- **One read for the same data.** Read through http-web's composables
  (`useList`, `useView` and the CRUD screens), which keep each read under its
  query key, so components showing the same list with the same parameters
  share one request, instead of a `fetch` of their own in each component.
- **Events, not polling.** A list or record refreshes on the realtime events
  that change it: a read composable's `realtime` option or
  `useRealtimeQueryInvalidation()` marks the matching reads stale and reads
  again only those a mounted screen uses, at most twice a query for a burst of
  events
  ([Realtime](/guide/app-extras/realtime#event-contract)). A `setInterval`
  that refetches is a finding.
- **Render what is visible.** A long list reads pages and renders with pages
  or `v-virtual-scroll`
  ([Screens](sanity-checks.md#screens)).

### Prove

Report the entry chunk and its preloads (gzip) from the build before and
after, the requests each main screen and action makes, and the main actions'
time from click to result on the production build, cold and warm. Keep a
request count in the spec that reaches the screen, as a count, never as a
time.

## Server speed

### Measure

- Boot the server in a test as [Tests](data-access.md#tests)
  shows, seed a realistic size in `TEST_DB_NAME`, and time the main routes
  over `app.inject`, the first request after boot and later ones.
  `countQueries(knex, work)`, or `countRuntimeQueries(work)` for a booted
  server, from `@jskit-ai/database-runtime/server/testDatabases`, gives the
  statements, so you can tell database time from the rest.
- Start the server with `node --cpu-prof` to see where a slow route or a slow
  start spends its computing time, in the `.cpuprofile` file it writes.
- After the app has been idle, list the server's child processes, timers and
  connections, and the jobs still running.

### Fix

- **Do once what does not change.** A feature builds what does not change
  between requests (a parsed configuration, a compiled schema, a client for an
  outside service) in `setup()` and starts it in `boot()`, never per request
  ([Owned state](typed-features.md#owned-state)).
- **Nothing runs without real use.** A process, worker or timer a feature
  starts has its owner stop it in `shutdown()`
  ([Shutdown mirrors setup](typed-features.md#shutdown-mirrors-setup)),
  and one that serves only some requests starts on its first real use and
  stops when idle. A periodic job's timer is `unref()`ed.
- **Work nobody waits for leaves the request.** Work over many rows or every
  workspace runs as a background job with `systemScope`
  ([Background work](data-access.md#background-work)).
- **Database time is the data pass's.** A count that grows with the rows, a
  read narrowed in code, a write that reads its row back with
  `returning: "record"` when it does not use it, and a missing index are
  fixed as the [data pass](data-pass.md) says.

### Prove

Report each main route's time before and after, with its statement count, at
the realistic size, the first after boot and later ones. Keep an
`expectFlatQueries()` test for each path whose count you changed.

Then run `npx jskit check`. `npm run verify`, the whole run, runs once, at the
end, only with the person's OK.
