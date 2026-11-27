---
title: Test pass
description: The command, file or check that proves each item of a test pass in a JSKIT app, from its test rules and its runs to its databases, its browser tests and what a JSKIT update breaks.
---

# Test pass

A test pass makes the test suite prove what the app does, quickly. Genesis's
test pass skill (`genesis-test-pass`) holds the method: each behavior's test
fails without it, each file owns what it uses and reaches no outside service,
preparation happens once per run and files run in parallel, every run names
every failure, and the guidance says exactly how the suite runs. This page is
JSKIT's half: for each item, the command, file or check that proves it in a
JSKIT app. Work through it top to bottom and tick an item only with its proof.
The rules it applies are in [Typed features](/guide/framework/typed-features),
[Database layer](/guide/app-setup/database-layer) and
[UI operations](/guide/framework/ui-operations); query counts belong to the
[data pass](/guide/framework/data-pass).

## Run the checks first

- `npx jskit check` reads the test scripts, test files, Playwright and Vitest
  configs, CI workflows and the root Vite config, and names what makes a run
  slow, fragile or unsafe, each finding with the change to make
  ([Test-run rules](/guide/framework/typed-features#test-run-rules)). Its
  findings are the pass's first items, and every one passes at its end.
- `npm run lint` passes too.

## Map and measure the suite

- The parts of a JSKIT app's suite, each one command: the Node tests
  (`npm test`, which is `jskit test --databases` once the app has a database),
  the client tests (`npm run test:client`, Vitest), the browser tests
  (`npm run test:e2e`, Playwright through `browserTestConfig()`) and the
  migration history (`jskit migration-history`). `npm run verify` runs them
  after `jskit check` and lint, as
  [Running the checks](/guide/framework/typed-features#running-the-checks)
  states once.
- `jskit test --list` prints the files a run takes and their total, and runs
  nothing: the total matches the test files under `tests/`, or a file is named
  so that node's default pattern leaves it out.
- `jskit test` starts by saying how many files it runs at a time and where that
  number came from (the host's `V64_TEST_CONCURRENCY`, else half the CPUs), and
  ends with its 10 slowest files and tests; each file's time is kept in
  `node_modules/.cache/jskit-test/file-times.json`. A run through
  `browserTestConfig()` ends with its 10 slowest tests, and test database
  preparation reports each phase and its duration.
- Take the baseline from one whole run of each part, its files in parallel at
  the real `V64_TEST_CONCURRENCY`: its per-file times are the baseline table.
  After a batch of fixes, run the part again for the times after, and compare
  per file and in total. A wall time near the sum of the files' times divided by
  the budget is right; near the plain sum, the files ran one after another. A
  single-file run (`npm test -- <file>`, which runs exactly that file) is for
  one change's red and green, never the way to take a baseline or a
  before-and-after table, and never one of serial runs queued one after
  another. Run on the host's test machine, when the host offers one, not on a
  shared development host; a time taken while other work loads the machine is
  reported as such and never used as a baseline.
- The pass's own measurement, one run of each part before the work and one
  after, is part of the pass the person asked for. `npm run verify`, the whole
  run, runs once, at the end, only with the person's OK.

## Each test proves a behavior

- Break the behavior and see its test fail: revert the line or return the
  wrong value, several at once in one run (`npm test -- <files>`), then
  restore it. A behavior no test catches gets one, seen to fail first.
- Nothing is weakened: no `test.skip`, `test.only`, `{ skip: true }`,
  `test.fixme`, `retries` or raised `timeout` in a test or config without its
  stated reason and the run that covers the skipped behavior.
- A rule or calculation is a Node unit test; data, access and refusals a server
  test over `app.inject` on the file's own database
  ([Tests](/guide/framework/data-access#tests)); what a component shows a
  Vitest component test; a browser test only for a flow across screens,
  navigation, layout at the standard widths, focus or the real sign-in. A new
  browser check is an assertion in the spec that already reaches the screen.
- A browser test finds what a person finds: `getByRole`, `getByLabel` and
  `getByText` with the app's own words, never a Vuetify class (`.v-btn`,
  `.v-list-item`), a generated class or text Vuetify supplies.
- A list, batch or write path has a count test at a few rows and at a
  realistic number: `expectFlatQueries()`
  ([data pass](/guide/framework/data-pass)). A count that grows with the rows
  is a product defect, fixed as the data pass says.

## Each file owns what it uses

- `jskit test --databases` gives each file running at once its own copy of
  `TEST_DB_NAME`, restored from the snapshot, and fails a run whose databases
  allow fewer files than the budget
  ([Integration test databases](/guide/app-setup/database-layer#integration-test-databases)).
  A test that needs more takes it from JSKIT: an empty scratch database from
  `createPackageTestKnex(t, { environment: process.env })`, a second copy of
  the snapshot from `claimTestDatabaseCopy(t, { environment: process.env })`,
  and its own copy afresh mid-file from
  `resetTestDatabase({ environment: process.env })`. A port comes from
  `listen(0)`, a directory from `mkdtemp`, a Vite `cacheDir` of its own.
- No name is written into a test, script, config or CI workflow:
  `jskit check` names a fixed database name and a CI `TEST_DB_NAME` equal to
  `DB_NAME`, and JSKIT refuses to run tests on `DB_NAME` at all.
- Under `jskit test`, the test processes and the app servers the browser tests
  start reach only loopback, unix sockets and the configured database hosts;
  any other connection fails with `JSKIT_TEST_NETWORK_REFUSED`, naming the host
  and the fix. That is the run with outbound network refused, on every run: a
  test that fails with it reached an outside service, so stub what it reached
  at the seam the app already uses. A file that must reach one says why on its
  first line, `// jskit-test: network - <reason>`, and runs without the guard.
- Every process `jskit test` starts runs as `APP_ENV=test`
  ([Environments](/guide/framework/environments)): only production sends for
  real.
- A file that holds a resource of the whole machine says so on its first line,
  `// jskit-test: alone - <reason>`, and runs after the others; no other file
  does.

## Each run takes the time its work needs

- Databases come from a snapshot taken once per change of the migrations'
  digest and kept on the database server, where `npm ci` cannot empty it: on
  MySQL and MariaDB the database `<TEST_DB_NAME>_0`, whose tables each copy's
  are made from, and a restore replaces only the tables a file changed; on
  PostgreSQL the database `<TEST_DB_NAME>_snapshot`, which each copy is created
  from ([Test databases are prepared once](/guide/framework/typed-features#test-databases-are-prepared-once)).
  A file that runs `knex.migrate.latest()` itself replays the whole history:
  remove it.
- `jskit migration-history` is the one check that replays the full history,
  from empty, as `APP_ENV=test`, and compares it with the snapshot. Rows a
  migration fills from the clock match: on MySQL and MariaDB both builds run
  with the clock stopped (`SET TIMESTAMP` and JavaScript's `Date`), and on
  PostgreSQL a value taken from the clock compares as the clock's. A seed
  stamped from a random value fails it; a migration that has run is never
  edited to fix it, a new one corrects the rows.
- A fixture every file only reads is made once, before any file starts:
  `jskit test --test-global-setup=tests/helpers/globalSetup.js`. Its
  `globalSetup()` puts the fixture's location in an environment variable the
  files inherit; a file run on its own makes the fixture itself, and a test
  that writes into it makes its own copy.
- `browserTestConfig()` builds the production frontend once and reuses it
  while its inputs are unchanged, and gives each of `browserTestWorkers()`
  workers (half the budget, at least one) its own server, port and seeded copy
  of `BROWSER_TEST_DB_NAME`; with a `signIn` module each worker signs in once.
  A build that writes into its own inputs is never reused (`not kept for
  reuse, as src changed while it ran`): vue-router's generated types go to
  `types/typed-router.d.ts`, outside `src`.
- No fixed sleep: a web-first assertion (`await expect(locator).toBeVisible()`),
  `expect.poll()`, the event itself, or a fake clock (`mock.timers`,
  `vi.useFakeTimers()`, `page.clock`) for the app's own delays. The one fixed
  wait that stays proves nothing happens in a window and says so on the line
  before, `// jskit-test: fixed-wait - <reason>`.
- A file imports what it needs at its top level, so loading counts against the
  file, not a test's time limit.
- The bounds stay: `jskit test`'s 10 minutes a file and 45 a run, and
  `browserTestConfig()`'s `actionTimeout`, `navigationTimeout` and
  `globalTimeout`. A bound in `test-time-bounds.json` rises only with a
  measurement of the work's real need.
- A passing run prints what a person reads: test servers log at
  `LOG_LEVEL=warn` unless the shell asks for more.

## Every run reports every failure

- Each part is one command that runs all its files in one parallel run:
  `jskit check` names a script that runs `node --test` itself, a fixed
  concurrency or worker count, and files or globs given to `jskit test`.
- `npm run verify` chains its parts with `&&`: it stops at the first part that
  fails, exits non-zero and npm names that script. Prove it once without a
  whole run: put a lint error in a file, see `npm run verify` stop at
  `lint` with a non-zero exit, and remove it. CI runs the same parts and fails
  on any of them.
- A failed, cancelled or timed-out test, and a file that fails to load, fail
  `jskit test`; `jskit test --list` shows the files the run takes.

## The guidance says how the suite runs

- The app's `AGENTS.md` keeps only what is specific to the app, and links
  these guides for the rest. `genesis/stack.md`'s Verification declares each
  part of `npm run verify`, in the same order, the browser suite on the
  production build included.
- A managed host runs the browser suite on its declared test target,
  `jskit browser-test-server {host} {port} {workers}`, which names
  `PLAYWRIGHT_PORT` so each worker opens its own server's database, never on
  the development server
  ([Browser verification](/guide/framework/ui-operations#browser-verification)).
- No rotten instruction stays: a development server for checks, the whole suite
  after each change, single files timed in turn, retrying or loosening a
  failing test, fixed sleeps, shared database names or ports, a hard-coded
  worker count, migrations replayed per test.
- The committed Agent Skill copies match the Genesis that serves the project:
  `genesis check` passes, and `genesis skills sync` refreshes them.

## After a JSKIT update

Update with `npm run jskit:update`, then fix what the update reports, these
first:

- `jskit check`'s test rules report patterns earlier releases let pass: a
  fixed sleep, a fixed database name, a CI test database equal to `DB_NAME`, a
  generated file written into `src`, files given to `jskit test`. Each finding
  names its change.
- The foundation patterns write vue-router's types to
  `types/typed-router.d.ts`: move the file and its `.gitignore` line, and point
  `dts` there.
- A test that reached an outside service now fails with
  `JSKIT_TEST_NETWORK_REFUSED`: stub it, or give the file its
  `// jskit-test: network - <reason>` line.
- Test servers log at `LOG_LEVEL=warn`: a test that reads info logs sets
  `LOG_LEVEL` itself.
- On MySQL and MariaDB the test database snapshot moved from
  `node_modules/.cache` to the database server: the first run takes a new one,
  and the old cache folder can go.
- `jskit migration-history` runs as `APP_ENV=test` by itself: an `APP_ENV=test`
  in front of it in a script can go.
