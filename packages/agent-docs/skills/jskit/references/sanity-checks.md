<!-- Generated from `packages/agent-docs/site/guide/framework/sanity-checks.md`. -->

# Sanity checks

Before calling a list, a save, a test, a refactor, a screen or a deployment
done, measure what it actually costs and does, judge whether that is sane, and
fix the cause when it is not. This page is the JSKIT part of that: the
pitfalls JSKIT's own packages cause, then which JSKIT call, helper or setting
applies each check, with one line on what the check catches and why.

## JSKIT's own pitfalls

### Theme and component defaults

**Check:** after changing a theme, a Vuetify default, a material-web default
or a shared component, use what it affects in a production build: open a
select and type, press a segmented button at desktop width, tap neighbouring
icon buttons, and leave a field to see whether the layout shifts under the
next tap. A default reaches every component that renders the one it names, so
a change made for one screen can break others that never import it
([Material 3](material-3.md)).

**Examples:**

- A `VMenu: { VSheet: {} }` default broke a select's typeahead.
- A common button padding squeezed segmented buttons into slivers.
- A field that grew 32 px on blur moved the button under a person's tap.

### Navigation metadata

**Check:** open each inner page directly and by link, and see its Up arrow
and title. Some navigation declarations look right but switch Up off, and
some shapes leave pages the navigation rules cannot judge
([Material 3](material-3.md)):

- a parent declared beside `jskit.surface` is never read; the surface goes on
  the layout page and the parent on the page it renders (`nav/surface-parent`
  reports the two on one record);
- an inner page repeating its surface becomes a root of its own, with no Up;
- until a main-navigation placement is literal data, no page is judged for a
  missing parent (`nav/placement-data`);
- a layout that also renders its pages without `ShellLayout` leaves those
  pages unjudged by `nav/missing-parent`, so a missing parent passes.

**Example:** a design-system update moved a page title into a top app bar
that one page did not have, so its title vanished; only the browser suite
caught it.

### Generated action and tool contracts

**Check:** call each assistant tool the way the model will, with sparse
`fields` and an `include`, and compare the result with the output contract it
advertises. An action is a tool only when it has an input contract and a
truthful model-facing output; the assistant validates the result against
`extensions.assistant.output` and rejects unexpected fields, so a contract
that promises what execution cannot return fails at run time, not at review
([Assistant](/guide/app-extras/assistant#database-surface-action-tools)).

**Example:** sparse primary fields stay sparse, and an included record is read
from its lookup container (`items[0].lookups.pet.name`); a contract that
expects the relationship id or an unselected field never gets it.

## Applying each check

### Every row

- An unpaged JSON:API query returns the first 20 rows, and a page above the
  resource's `queryMaxLimit` (100 unless it sets one) is cut to that size,
  both without an error; CRUD `queryDocuments()` refuses such a `limit`. A
  read its callers treat as complete uses `queryAllJsonRestCollectionRows()`
  or the repository's `queryEveryDocument()`, because the missing rows
  otherwise vanish from every picker and delivery built on it
  ([Every row](typed-features.md#every-row)).
- A lookup by a unique key matches at most one row, so it may read `rows[0]`
  of a plain query.

### Query counts and batches

- Count a path's queries with the test Knex instance's `query` event at a few
  rows and at a realistic number; the count should follow tables and pages,
  not rows ([Query counts at realistic
  sizes](typed-features.md#query-counts-at-realistic-sizes)).
- A JSON:API read adds a few lookup and visibility queries per page and per
  relationship field. That follows pages, so it is expected.
- `getDocumentById()`, `queryDocuments()` or a service `get` inside a loop is
  the usual per-row read; batch it with an id-list `searchSchema` filter or
  `include`, grouped with `Map.groupBy()` ([Lists read related rows in
  batches](typed-features.md#lists-read-related-rows-in-batches)).
- A `rowPolicy` adds one correlated predicate to the query it is given, so
  its cost follows the rows read, not the subject's history. It runs on every
  single-record read, including a write's default `returning: "full"` read
  back, so a write that discards its result passes `returning: "minimal"` and
  a batch of creates uses `createDocuments()`, in the owner's transaction
  ([Bounded access
  checks](typed-features.md#bounded-access-checks)).

### Tests

- `jskit test` runs test files in parallel within the machine's test budget
  (`V64_TEST_CONCURRENCY`, else half the CPUs), and Playwright's `workers` and
  Vitest's `maxWorkers` come from `testConcurrency()`. `jskit check` reports a
  script or config that runs files one at a time; a file that must run alone
  says why on its first line, `// jskit-test: alone - <reason>` ([Test files
  run in parallel](typed-features.md#test-files-run-in-parallel)).
- Tests use `TEST_DB_NAME` and `BROWSER_TEST_DB_NAME`, both different from
  `DB_NAME`, because tests write and delete rows and would destroy the
  developer's data. A skip for want of a test database is a failure.
- Test databases restore a stored snapshot checked by a digest of the
  migration and seed sources, and the harness reports each preparation phase's
  duration, so slow preparation shows ([Test databases are prepared
  once](typed-features.md#test-databases-are-prepared-once),
  [integration test
  databases](/guide/app-setup/database-layer#integration-test-databases)).

### Inputs and access

- An action input declared `mode: "patch"` makes every field optional. Use it
  only for an action that updates part of a record, and send that action
  nothing to see what it does, because a missing field is then never refused.
- A route that repetition can abuse declares `rateLimit`, which the kernel
  refuses with 429 and `kernel.http.rateLimited`; auth's limits come from
  `config.auth.rateLimits` ([Sign-in
  protection](/guide/app-setup/authentication#sign-in-protection)). Each
  limit needs a test expecting the 429, or a dropped one goes unseen.
- Who acts comes from `resolveActor(context)` and the workspace from the
  context's resolvers ([One reader per
  fact](typed-features.md#one-reader-per-fact)); send another
  workspace's id in the body and see the context win.

### Refactors

Before changing a JSKIT feature, list where its behaviour lives, with the test
that covers each item, and walk the list again after: routes, actions and
their input schemas, row policies, CRUD fields, lookups and hooks, placements
and navigation meta, messages and their codes, events, jobs and migrations.
These are the places a consolidation drops behaviour without a failing build.

### Changes others depend on

- After updating JSKIT packages, read [Upgrade
  JSKIT](/guide/app-setup/upgrading-jskit) and each package changelog's
  "Upgrading" notes, then boot, sign in and run the browser tests before
  anything else, because a changed default shows only at run time.

### Screens

- A long list renders what is visible, with pages or `v-virtual-scroll`,
  because every row rendered costs DOM nodes and main-thread time.
- Command feedback goes through the shell's snackbar path: `ShellErrorHost`
  keeps it clear of the FAB and the actions it reports on, and a full-screen
  dialog puts its confirm action in the top bar, where a snackbar never covers
  it ([Material 3](material-3.md)).
- Up is the shell's, from `meta.jskit.parent`; the navigation rules forbid
  `router.back()` and hand-made back controls, so Up lands inside the app
  even on a page opened from a link.

### Production settings

- `NODE_ENV=production` is JSKIT's only production switch. Without it a
  deployed server runs as development: no first-account setup code, and
  development-only settings accepted.
- On an empty production database, local auth asks for the first account's
  setup code, so whoever reaches a new deployment first cannot own it ([The
  first account in
  production](/guide/app-setup/authentication#the-first-account-in-production-local-auth)).
  Give any registration of your own the same protection.
- `config.securityHeaders` sends the security headers, with the content
  security policy reported, not enforced, by default; read them on a
  production build ([Security
  headers](/guide/app-setup/initial-scaffolding#security-headers)).
- Email confirmation needs `auth.local.confirmation-sender` in production, or
  the server refuses to start while anyone may register ([Email
  confirmation](/guide/app-setup/authentication#email-confirmation-local-auth)).
- Changing the assistant's instructions needs `assistant.settings.update` or
  the surface's own permission ([Who may change the
  instructions](/guide/app-extras/assistant#who-may-change-the-instructions)).
  Its tools run as the typing user, through the `automation` channel, so an
  action kept off that channel is never a tool.
