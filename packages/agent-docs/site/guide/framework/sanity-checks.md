# Sanity checks

JSKIT's other guides say how to build. This page says what to check before
calling data access, a refactor, tests, inputs, a release, a screen or a
deployment done: measure what the code actually costs and does, judge whether
that is sane, and fix the cause when it is not.

Each check gives what good looks like, what to look at, real examples and an
outer limit. An outer limit marks something clearly broken: stop and find the
cause. It is not a target. Never bend code to reach a number, and never shrink
the data, loosen an assertion or raise a time limit to get past one. Prefer
counts (queries, rows, DOM nodes, requests) to clock times: a count is the
same on a loaded machine, and a time is read as a coarse bound.

Read this page before writing a list, a save, a batch or a test, before a
refactor or consolidation, and again before calling the work done.

## Never do these

These are wrong whatever the context:

- **Never cap a read that its callers treat as complete.** The missing rows
  vanish without an error. A JSON:API query without a page returns the first
  20 rows, and a page above the resource's `queryMaxLimit` (100 unless it sets
  one) is cut to that size; read every row with
  `queryAllJsonRestCollectionRows()` ([Every
  row](/guide/framework/typed-features#every-row)).
- **Never drop a behaviour, rule or access decision silently.** Only the
  person who owns the product can approve a loss, and then it is not silent.
- **Never declare a constraint or protection that nothing enforces.** A
  required field, schema rule, lock or rate limit that is ignored lets wrong
  data, races and abuse through while the code reads as safe. When the layer
  cannot enforce it, refuse to start.
- **Never decide access from the client's ids or from a missing value.** The
  authenticated context says who is acting and in which workspace; an id from
  the input, the record or the URL never wins over it, and a missing role,
  scope or collaborator refuses instead of allowing.
- **Never store a missing value as a real one.** A blank stored as `0`,
  `"undefined"` or "healthy" corrupts the data and cannot be told apart later.
- **Never run tests against the developer's or a production database,
  storage or configuration.** Tests use `TEST_DB_NAME` and
  `BROWSER_TEST_DB_NAME`, both different from `DB_NAME`, their own storage
  directory, and their own configuration. They write and delete rows and
  files, so they destroy real data. A test that skips because no test
  database is set is a failure to fix, not a pass.
- **Never edit a migration that has run anywhere.** Databases that ran the old
  one diverge from fresh ones; add a new migration instead.
- **Never let the first person to register on an empty production database
  become its owner.** Whoever reaches a new deployment first would own it.
  Local auth asks for the first account's setup code; keep it, and give any
  registration of your own the same protection.
- **Never deploy without `NODE_ENV=production`.** JSKIT decides production
  from it alone, so without it a deployed server runs as development: no
  first-account setup code, no production security headers, and
  development-only settings accepted.
- **Never stop a server, browser, child process, socket or timer only in a
  test body's `finally`.** A test that times out never reaches it, and the run
  hangs. Use `t.after()` or `after()`, which run after a timeout too.

## Data access

### Loading a dataset

**Good:** reading a list, page or report takes about the same number of
queries for 10 rows as for 200. Related rows come in batches, through an
id-list filter or `include`, and access is one predicate in each query.

**Check:**

- Seed realistic counts: hundreds of rows and long per-person histories.
- Count the queries at a small and at a realistic size with the Knex `query`
  event ([Query counts at realistic
  sizes](/guide/framework/typed-features#query-counts-at-realistic-sizes)),
  and look at what grows.
  - A count that grows with the rows means something runs per row: a
    single-record read, lookup, service `get` or access check inside a loop or
    a `Promise.all` ([Lists read related rows in
    batches](/guide/framework/typed-features#lists-read-related-rows-in-batches)).
  - A count that grows with a person's history means a row policy sized by
    history ([Bounded access
    checks](/guide/framework/typed-features#bounded-access-checks)).
  - JSON:API reads add a few lookup and visibility queries per page and per
    relationship field. That follows pages, not rows, and is expected.
- Read the SQL the count captured: a schema catalogue read
  (`information_schema`, `pg_catalog`) on a request path, a row read back just
  after it was written, the same statement repeated with one id at a time, the
  same policy run several times in one request, a policy statement that runs
  to kilobytes.
- Time the call, and also open the page on an empty database.

**Examples:**

- A page of 100 incidents read each incident's revision, pinned module and
  restricted readers one incident at a time: 1,801 queries and 5 to 7 s.
  Batched per table it took 181, and that was still about one a row; the count
  should not follow the rows at all.
- A module list called a single-record read per module: 1,885 queries for 69
  modules. Batched, it took 65 queries and 0.27 s.
- A notice row policy loaded every source a reader had ever been notified
  about and checked each one, so a batch of 100 notices took 26 to 33 s and
  13,176 queries. Another policy's SQL reached 206 KB and took about 40 ms to
  plan before it read a row.
- Foreign keys looked up in `information_schema` on every call took 25 to
  63 s a call on a server with about 740 databases. Read once, a lookup took
  0.02 s.

**Outer limit:** a list or page that makes hundreds of queries, or takes over
a second on a quiet database, is broken; so is one request that runs the same
access check more than a few times.

### Saves and batches

**Good:** a person's save does that save's work. Work across many rows is
written in bulk, and work nobody waits for (settling a league, delivering
notices, planning tomorrow) runs as a job, outside the save.

**Check:**

- Count and time a save the same way, with realistic data around it.
- Look for awaited writes in a loop, a `createDocument()` per row of a batch
  (each one checks its lookups and reads its row back through the row policy),
  and work inside the save that the person does not need before it returns.
  A batch writes each table in one statement through the repository, in the
  owner's transaction ([Bounded access
  checks](/guide/framework/typed-features#bounded-access-checks)).

**Examples:**

- The first workout saved each week settled every member's weekly league
  inline, two updates and an insert per member: 35 to 44 s. The save should
  write the workout and leave the settling to a job that works in bulk.
- An install wrote each rule row through the full create path, about 8.5
  queries a row: 34,640 queries and about a minute. One insert per table took
  one store from 2,153 queries to 18.
- A planner issued up to 5,000 single-row updates a run.

**Outer limit:** one action or install that makes thousands of queries, or
runs for tens of seconds, is broken.

## Refactors keep behaviour

**Good:** a consolidation, move, conversion or rewrite keeps every behaviour,
or removes one deliberately, with the owner's agreement, and says so.

**Check:**

- Before changing code, list what it does: its routes and actions, each
  input's validation, permissions and row policies, CRUD fields, lookups and
  hooks, pages, placements and links, messages, events, jobs and migrations,
  and the states and edge cases each one handles. Note the test that covers
  each item, and add one where none does.
- Where you can, compare old and new directly: the same requests, made by a
  few people with different access, give the same responses before and after.
- After the change, walk the list again. The original tests pass with their
  assertions unchanged; an assertion that had to change marks a behaviour that
  changed.

**Examples:**

- An engine consolidation that replaced several near-copies with one shared
  implementation removed or changed 237 behaviours, safety rules and access
  decisions among them. They were found only at review and restored one by
  one.
- A design-system update moved a page title into a top app bar that one page
  did not have, so its title vanished; another lost the return to its list
  after Add. Only the browser suite caught them.
- A list's fix kept its response bodies byte-identical for six people and four
  list reads, which proved nothing was lost.

**Outer limit:** a review that finds dozens of dropped items after the work is
"done" means the list was never made. A refactor that deletes tests or weakens
their assertions is not a refactor.

## Failing tests are bugs

**Good:** every red test has a cause and an owner. A final run is one run of
the whole suite, on the tree that is pushed. Every skip names its reason and
the run that does cover it, and every test can fail.

**Check:**

- Triage each failure, including one that also fails on the main branch: a bug
  to fix, a rule someone must decide, or a wrong test to remove. "Pre-existing"
  is not a cause.
- Report reruns, chunks, runs a failure cap stopped and other partial runs as
  partial. One whole-suite run on one tree is the final run.
- Before pushing, compare the commit the run tested with the one you push.
- List the skips and where each one runs. A skip because something in the
  environment is missing is a failure to fix.
- Break the behaviour, or revert the fix, and see the new test go red.

**Examples:**

- A proof with 228 failures and 94 timeouts was recorded as a proof because
  the baseline had 350 failures.
- A cap of two failures per group stopped a browser run early, and 371 of its
  701 tests never ran.
- Seventeen billing defects (a fee of 688 charged instead of 2,750, GST
  charged twice) failed on CI and stayed unfixed, while local runs skipped
  those tests for want of a test database.
- About half of one suite's 291 "pre-existing" failures were one framework
  regression that the baseline hid.
- A URL assertion that also matched the starting page passed whether or not
  the action worked.

**Outer limit:** a main branch with a red test nobody owns, a suite that needs
more than two reruns to look green, or dozens of skips nobody can name a
runner for, is broken.

## Tests

### The suite takes the time its work needs

**Good:** test files run in parallel, each file prepares only what it uses,
the test database is prepared once per run and restored rather than rebuilt,
and nothing waits for time to pass.

**Check:**

- Read the suite's total time and its slowest files: `node --test
  --test-reporter=spec` prints each test's time, and Playwright's `list`
  reporter each spec's. Compare the total with the summed file times and the
  machine's cores: a total near the sum means the files ran one at a time
  ([Test files run in
  parallel](/guide/framework/typed-features#test-files-run-in-parallel)).
- For each slow file, find where the time goes: database preparation,
  migrations, sleeps, polling, server or build starts. Fix that cause ([Time
  limits are not fixes](/guide/framework/typed-features#time-limits-are-not-fixes)).
- Time database preparation on its own. A test database is normally ready in
  a second or two; one rebuilt by replaying every migration costs more with
  each migration added ([Test databases are prepared
  once](/guide/framework/typed-features#test-databases-are-prepared-once)).
- Compare each time limit above the default with the test's measured time: a
  limit many times the need hides the bug. Check that a limit exists too: a
  suite without one hangs instead of failing.
- A fixed sleep (`page.waitForTimeout()`, a `setTimeout` promise) waits its
  whole length when the condition already holds, and still fails when it holds
  late. Wait for the condition instead: `await expect(page).toHaveURL(…)`,
  `expect.poll()`, an event.
- Look at how long a page takes to load in a browser test, and when it takes
  seconds, find why. A development server sending hundreds of unbundled
  modules calls for a build made once for the run; a catch-all
  `page.route("**/*")` sends every request through the test and turns the
  browser cache off, so route only the requests the test fakes.
- Assert counts, not clock times: a 1,500 ms assertion flips between pass and
  fail on a shared machine, while a DOM node count with a coarse 10 s bound
  does not.

**Examples:**

- Every package and generated application passed `--test-concurrency=1`,
  copied from one release's templates. Removing it took one suite from 965 s
  to 506 s; one application's serial database suite took 58 min.
- Test databases rebuilt by replaying 300 migrations took 80 to 180 s each
  time, 60 to 70% of one database suite. Another application's 45 migrations
  took 21.5 s, where restoring a snapshot takes 0.2 s.
- A browser suite carried 458 raised time limits, most of them 180 s against
  a 60 s default, and a test with `test.setTimeout(180_000)` measured 8 s.
- A pause of 450 ms before each screenshot in one suite, and two of 1.2 s in
  another.

**Outer limit:** a suite that runs for hours, or a small application's suite
that runs for an hour, is broken; so is test database preparation measured in
minutes, or a limit ten times what its test needs.

### Each test owns what it uses

**Good:** a test creates and signs in as the records it asserts on. A file has
its own database or schema, port and temporary directory, generated or handed
to its worker, so it can run alone, twice, or beside any other file.

**Check:**

- Run the suite twice in a row, and beside another run; run one file on its
  own and the specs in reverse order. The results must not change.
- Look for tests that clear or count whole tables, that expect rows left by
  earlier runs, that rely on a sign-in or seed another file made, and for
  fixed ports shared between workers.

**Examples:**

- Test files shared one database that drifted: a test cleaned up after
  earlier runs by marking every queued job failed.
- 49 of one application's 50 failing browser specs never signed in
  themselves; they relied on state other specs had left.
- A spec expected a pet's status because another file had reset it, so the
  two could only run in one order, on one worker.

**Outer limit:** a suite that passes only in one order, or a result that
changes between two identical runs, is broken.

### Nothing hangs or lingers

**Good:** every server, browser, child process, socket, timer and connection a
test starts is closed in `t.after()` or `after()`, and the process exits as
soon as its tests end.

**Check:**

- After a file's tests, look at what keeps its process alive
  (`process.getActiveResourcesInfo()`). After a run, check that no server,
  browser, port, temporary directory or test database is left behind.
- A wait for animations waits only for finite ones: `document.getAnimations()`
  also returns endless ones, such as a spinner's, which never finish.
- Prefer events and injected clocks to polling a socket or waiting out a
  deadline.

**Examples:**

- A test timed out before its `finally`, leaving Vite and Chromium running,
  and the run hung for over an hour.
- Two database tests with no time limit hung for 26 to 36 min.
- A pointer resting on a snackbar paused its timeout, so a test waited out its
  whole 180 s limit.
- The code under test can be the cause: a server's shutdown never cleared its
  20 s drain timer, so every server a test closed stayed alive for 20 s.

**Outer limit:** a run that hangs, or a file that ends only when its time
limit kills it, is broken.

## Inputs and access

**Good:** every rule the code declares is enforced: required fields, enums and
lengths, locks, rate limits and permissions. The workspace and user come from
the trusted context. Authorization is decided before validation answers, and
a missing value stays missing.

**Check:**

- For each declared constraint and protection, send one request that breaks
  it and see it refused: a missing required field gets a 400, the call past a
  rate limit a 429, a caller without the permission a 403. Before removing a
  guard as redundant, prove the layer below enforces it.
- An action input declared `mode: "patch"` makes every field optional. Use it
  only for an action that updates part of a record, and check what that action
  does when it is sent nothing.
- For each id a handler uses for access, trace where it comes from, then send
  another workspace's id in the body: the context wins, or the request is
  refused.
- Send a malformed request as someone without the permission: they get a 403
  and no field errors.
- Submit each optional number, date or id blank, and read what is stored: it
  stays null, and the screen says it was not recorded.
- For each access default and optional collaborator, ask what happens when it
  is missing. The answer must be a refusal, never "allowed" or a silent
  success.

**Examples:**

- A settings toggle whose input never enforced `required` switched password
  sign-in off when its `enabled` field was missing.
- A numbering command sent without an id renumbered every voucher in the job.
- A handler read `input.workspaceId ?? context.workspaceId`, so a user could
  act in another workspace.
- A blank moisture reading was stored as 0% through `Number(null)`, and missing
  counters were recorded as a healthy 0.
- A realtime event with no scope was broadcast to every user.
- A route's declared rate limit was dropped and protected nothing, unseen
  because no test ever expected the 429.

**Outer limit:** a request missing a required field that succeeds, or one
that acts in a workspace its user is not in, is broken.

## Changes others depend on

**Good:** a change to something other code reads (an environment variable's
name, a default, a package's contract, a shared component) fails loudly, with
its fix named, wherever the old shape is still used, and every application and
starter that reads it is updated with it.

**Check:**

- Before releasing such a change, list every application and starter that
  reads it; boot each, sign in and run its browser tests.
- After updating JSKIT packages in an application, do the same before
  anything else, and read what the release changed.
- A changed default belongs in a release that says so, never in a quiet patch.

**Examples:**

- A renamed browser-test sign-in variable left many projects' browser tests
  running signed out, passing or failing for the wrong reason.
- A patch release turned email confirmation on and refused a production start
  without a sender, which stopped one application's invitations.
- A version pin pushed without a browser run changed how a client default was
  read, so account status never loaded.
- Good: the kernel refuses to start when a route declares `config.rateLimit`
  and the application also registers the rate-limit plugin itself, a loud
  failure that names its fix.

**Outer limit:** a project that runs differently after an update without
saying so is broken.

## Screens in use

**Good:** a screen stays fast and usable with realistic data, at phone width,
and while someone uses it.

**Check:**

- Load it with realistic data and count what it renders
  (`document.querySelectorAll("*").length`). Render what is visible, with
  pages or `v-virtual-scroll`, instead of everything.
- Open the first screen with the browser's network panel and read its bytes
  and request count; follow a large chunk to the import that pulls it in.
- Look at it 390 px wide: content in a fixed-height box must not run under the
  navigation, where it cannot be scrolled.
- After each piece of feedback, use the next action and press Escape: a
  snackbar or message must not cover Save or the control the person needs
  next, nor take the keyboard from an open dialog ([Material
  3](/guide/framework/material-3)).
- After changing a theme, a Vuetify default or a shared component, use what it
  affects: open a select and type, press a segmented button at desktop width,
  tap neighbouring icon buttons, and leave a field to see whether the layout
  shifts under the next tap.
- Check that what a template shows changes when its inputs change, in a
  production build. Slots are not reactive: read `useSlots()` in the template
  or render function, not inside a `computed`.

**Examples:**

- A diagram rendered 25,764 DOM nodes for 130 tables, with main-thread tasks
  of up to 4.5 s.
- A 5 s snackbar sat over Save, so the next save had to wait for it to close,
  and it took Escape from open dialogs.
- A `VMenu: { VSheet: {} }` default broke a select's typeahead, and a common
  button padding squeezed segmented buttons into slivers.
- A field that grew 32 px on blur moved the button under a person's tap.
- A page header read `useSlots()` in a `computed` and lost its buttons in
  production.

**Outer limit:** tens of thousands of DOM nodes for one view, typing that
lags, or a first screen that loads megabytes of code or hundreds of requests,
is broken.

## Production settings

**Good:** a new production deployment is safe before anyone uses it.

**Check:** start the application as production and look at:

- `NODE_ENV=production` in its environment, and no development-only flag,
  `localhost` address, fixed port or fixed secret in its configuration;
- who can create the first account (the setup code);
- the security headers its responses carry (`config.securityHeaders`);
- the rate limits on the sign-in, registration and recovery routes;
- whether email confirmation is on, and has a sender when it is;
- who may change the assistant's instructions, and what an ordinary user's
  assistant can read;
- what `npm audit --omit=dev` reports.

JSKIT's defaults cover these. The check is that the application has not turned
one off or worked around it.

**Example:** a security review of a deployed application found it running
without `NODE_ENV=production` and without a sign-in rate limit, on an empty
database whose first registrant would have become its owner.

**Outer limit:** a production server that lets its first visitor own it, or
that runs as development, is broken.
