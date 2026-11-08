---
title: Upgrade JSKIT
description: Keep root and workspace package declarations on one published JSKIT release cohort and enforce it in CI.
---

# Upgrade JSKIT

JSKIT packages are released as one coordinated catalog. Upgrade the whole
declared graph together; do not update an assistant, shell, web runtime, or
workspace package in isolation.

## Add the supported project commands

Current application foundations already contain these entries. For an older
application, add the scripts at the project root; the updater adds the exact
coordinated catalog dependency itself:

```json
{
  "scripts": {
    "jskit:update": "npx --yes @jskit-ai/jskit-catalog@latest update",
    "jskit:check": "jskit check"
  }
}
```

If a legacy application still declares the retired authoring CLI, remove it
first:

```bash
npm pkg delete 'devDependencies.@jskit-ai/jskit-cli'
```

For app-local packages installed by the root npm installation, use npm workspaces. Declare the workspace paths at the root and depend on each local
package by its exact manifest version. Do not retain legacy `file:` links; the
updater does not infer or rewrite an application's local package topology.
Separately composed packages can instead supply explicit additional manifests
as described below; they do not need to become npm workspaces.

The shell and authentication packages use Pinia 4. Before upgrading an app
that still declares Pinia 3, update its manifest without installing the old
JSKIT graph:

```bash
npm pkg set 'dependencies.pinia=^4.0.3' 'dependencies.@vue/devtools-api=^8.2.1' 'dependencies.vue-router=^5.3.1' 'dependencies.vue=^3.5.44'
```

Update any workspace Pinia declarations too. Pinia 4 requires ESM and the
separate `@vue/devtools-api` peer; the current application foundations include
both, with Vue Router 5.3.1 and Vue 3.5.44. Vue Router 5.0.6 still requires
Pinia 3. The JSKIT updater changes only JSKIT dependencies, so it does not make
this application-owned dependency change for you. Do not bypass peer conflicts
with `--force` or `--legacy-peer-deps`.

Then let the published updater select and install its exact coordinated
catalog:

```bash
npm run jskit:update
```

The updater rejects unknown JSKIT packages and private JSKIT overrides during
preflight, before changing any manifest. It removes a package a release retired
(`@jskit-ai/json-rest-api-core`, replaced by `@jskit-ai/resource-runtime`) and
says what replaced it; while the application's code still imports a retired
package, it refuses and names the import to use instead.

`jskit:update` reads the latest published catalog, discovers the root manifest
and npm workspaces, and preflights every declared `@jskit-ai/*` package. It then
updates all matching dependency, development-dependency, peer-dependency, and
optional-dependency declarations as one validated manifest set. Non-JSKIT
dependencies are unchanged. It installs once from the root and checks the new
`package-lock.json` before succeeding.

During installation, the updater preserves non-JSKIT lockfile pins, removes the
old JSKIT installation records from the candidate lock, and keeps the previous
`node_modules` tree aside until the new graph passes `jskit check`. If writing,
installation, or validation fails, it restores the previous manifests,
lockfile, and installed tree before reporting the failure. Resolve the reported
registry or real peer problem and rerun `npm run jskit:update`.

When the install brings package migrations the application has not had, the
updater lists each one (`<package>: <file>`) and says to run
`npm run db:migrate`. Run it, on every database the application uses, before
the new version serves requests: a package's new version reads what its
migration creates, so until then those reads fail, such as every local sign-in
with an unknown `email_verified_at` column. Read each package's CHANGELOG
**Upgrading** section too, for the changes the application itself must make,
such as a feature to register.

## Separately composed packages

Pass each additional manifest explicitly to both commands:

```bash
jskit update --manifest private/feature/package.json
jskit check --manifest private/feature/package.json
```

Repeat `--manifest` for more packages; paths are relative to `--root` (or the
current directory). Missing files fail. Additional manifests join declaration
preflight, updates and rollback, but their dependencies are not expected in the
root lockfile. The host must check them in the actual composed installation.
Existing `jskit:update` and `jskit:check` scripts are preserved, so a host wrapper
can supply its own canonical composition list on every invocation. Absent scripts
receive the standard defaults.

A host coordinating multiple repositories resolves the desired catalog tag once,
then invokes that exact published catalog version for each repository. It must
record all resulting manifests and lockfiles. Normal checks and startup use the
installed, recorded catalog and do not query the registry.

The package exports `@jskit-ai/jskit-catalog/project-packages` for hosts:

- `updateProject({ projectRoot, catalog, additionalManifests, install })` uses the
  same updater as the CLI. Each root update retains its own rollback transaction.
- `checkProject({ projectRoot, catalog, additionalManifests, checkInstalled: true })`
  also compares lock declarations and installed versions with the root lockfile.
- `checkInstalledGraph({ catalog, manifestPaths })` follows runtime dependencies
  and peers from the composed consumer manifests through real filesystem paths.
  It detects missing required dependencies, conflicting JSKIT releases, and
  separate copies of catalog-declared singleton runtimes, even at equal versions.
- `resolveInstalledPackage(consumerDirectory, packageId)` returns the resolved
  real manifest path, or `null`, without requiring a package.json export. Hosts
  use it for their additional non-JSKIT requirement validation.

Do not aggregate separate tool installations as one runtime graph: pass the
composed application manifest and let resolution identify its actual consumers.
The installed-graph check does not replace application-owned non-JSKIT version
validation or the original root lockfile checks.

### Explicit development sources

Hosts composing selected source checkouts can pass `sourcePackages`, an explicit
package-name-to-directory map, to both `checkProject` and `checkInstalledGraph`.
The former exempts only these replaced names from published declaration and
root lock/installed-version comparisons. Pass the corresponding **materialized**
directories to the latter: it validates package identity and required dependencies,
rejects resolution outside each selected real path, and still rejects duplicate
singleton runtimes, including identical-version copies. Selected source versions
and their consumer ranges need not match the published catalog.

Always run both stages. Source preflight alone does not prove a usable graph.
The host still validates external dependency compatibility and prepared exports.
Unselected packages retain ordinary checks. This programmatic development option
does not modify manifests or locks, change release pins, or relax CLI/update/CI
defaults. A missing selected checkout must fail; it is not permission to choose a
published package instead.

## Enforce the graph in CI

Run this after `npm ci`, and include it in the application's normal verifier:

```bash
npm run jskit:check
```

For example:

```json
{
  "scripts": {
    "verify": "npm run jskit:check && npm run lint && npm test && npm run build"
  }
}
```

The check fails when:

- a root or workspace JSKIT declaration differs from the installed coordinated
  catalog;
- resolved JSKIT packages use stale, unknown, or multiple release versions;
- a shared singleton client package has a private nested installation;
- a JSKIT override tries to force a private graph;
- a root/workspace declaration has no lockfile installation, or the lockfile is missing;
- installed package versions or root/workspace declarations disagree with the lockfile.
- a package script runs tests outside the machine's test budget (`test/*`, see
  [Test files run in parallel](/guide/framework/typed-features#test-files-run-in-parallel)).

Shared client owners such as the kernel, HTTP runtime, shell, auth web runtime,
realtime runtime, and assistant runtime use exact peer dependencies where they
must share application state. A partial upgrade can therefore fail during npm
installation instead of silently nesting a second client stack.

## Run tests within the test budget

Plain `jskit check` fails a test run that ignores the machine's test budget
([Test files run in parallel](/guide/framework/typed-features#test-files-run-in-parallel)).
An application adopts it once, at the upgrade that brings `jskit test`:

1. Its test scripts run `jskit test` with their own files or globs, for
   example `"test": "jskit test"`, never `node --test` or
   `--test-concurrency`.
2. `playwright.config.*` sets `workers: testConcurrency()` and the Vitest
   config sets `maxWorkers: testConcurrency()`, with
   `import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";`,
   and no script passes `--workers`, `-j` or `--maxWorkers`.
3. Files that collide when run together get their own port, temporary
   directory, database or schema, and Vite `cacheDir`; a file that truly
   must run alone says why on its first line, `// jskit-test: alone - <reason>`.
4. The whole suite passes with the budget, and its time before and after is
   recorded.

## Move browser and database tests onto the JSKIT harness

The release that brings `browserTestConfig()` and `jskit test --databases`
makes JSKIT own the fast test harness. Plain `jskit check` fails a Playwright
webServer on the development server (`test/playwright-dev-server`), one
webServer every worker shares (`test/playwright-isolation`), and a config
without a `globalTimeout` (`test/playwright-global-timeout`). At that repin, an
application:

1. Deletes its own copies of the harness: a local test-budget helper
   (`testConcurrency()` in its own scripts), a launcher that starts a server
   per worker, a cached production-build step, worker port and database-name
   helpers, a Node test runner wrapper that hands each file a database, and
   its schema-snapshot code. It imports `testConcurrency()` from
   `@jskit-ai/jskit-catalog/test-budget` wherever it still needs the number.
2. Replaces `playwright.config.*` with
   `defineConfig(browserTestConfig({ testDir: "./tests/e2e", prepare: "tests/e2e/databases.js" }))`
   from `@jskit-ai/jskit-catalog/browser-tests`, with `server`, `build`, `env`
   or `port` only where its own differ from `node ./bin/server.js`,
   `npm run build` and 4173, `globalTimeout` only for a suite measured to
   need more than 20 minutes, and `actionTimeout` or `navigationTimeout` only
   for an action or page measured to need more than 15 or 30 seconds (a stale
   locator should fail in seconds, not minutes). Settings a config adds (projects, a globalSetup
   that proves the server's identity, `timezoneId`) spread over the result:
   `defineConfig({ ...base, projects, use: { ...base.use, timezoneId } })`. A
   second local Playwright config and any `npm run develop` or `vite`
   webServer go.
3. Copies its database pattern's `example/tests/e2e/databases.js` and moves
   its browser fixture seed into its `seed`; each worker's server then gets a
   seeded copy of `BROWSER_TEST_DB_NAME`. Server settings for tests only (a
   simulated email or payment driver) go in `browserTestConfig({ env })`.
4. Runs Node tests with `"test": "jskit test --databases"`, with
   `TEST_DB_NAME` distinct from `DB_NAME`, `BROWSER_TEST_DB_NAME` and
   `PROD_DB_NAME`, and a database user that may create its numbered copies
   (`CREATEDB` on PostgreSQL). Test files read `DB_NAME`/`TEST_DB_NAME` as
   given rather than naming the test database themselves, and no longer
   create, migrate or drop it: the run hands each file a restored copy.
5. Proves it with a timed full run: `npm test` and `npx playwright test`, every
   test passing, the time of each before and after recorded, and the slowest
   tests the run lists read.

## Cache built assets for good

The foundations' `server.js` serves each content-hashed file under
`dist/assets/` with `Cache-Control: public, max-age=31536000, immutable`, so a
page load no longer revalidates every script and stylesheet the build made;
`index.html` and unhashed files are still revalidated on every load. An
application copies `HASHED_ASSET`, `HASHED_ASSET_CACHE` and the
`reply.sendFile()` choice from its foundation's `example/server.js` into its
own `server.js`, with the browser test "built assets are kept for good and the
page itself is revalidated" from `example/tests/e2e/startup.spec.ts`. A spec
that mocks requests with `page.route()` turns Playwright's HTTP cache off, so
it still fetches every asset on each navigation.

## Sign each browser worker in once

A suite whose tests sign in one by one, such as a helper that calls
`loginAsExistingUser()` at the start of each test, signs each worker's server
in once instead, with `browserTestConfig({ signIn: "tests/e2e/sign-in.js" })`:

```js
// tests/e2e/sign-in.js: `env` is the worker server's environment.
import { loginRequestAsExistingUser } from "@jskit-ai/auth-web/test/playwright";

export default ({ request, env }) =>
  loginRequestAsExistingUser(request, { email: "owner@example.com", secret: env.AUTH_DEV_BYPASS_SECRET });
```

The servers' launcher runs it once per server, after the servers start. Each
test of that worker then starts from the signed-in storage state, which the
worker's process also finds in `PLAYWRIGHT_STORAGE_STATE`, as on a managed
target, so a helper that skips signing in under `PLAYWRIGHT_STORAGE_STATE`
skips it locally too. A test that must start signed out uses
`test.use({ storageState: { cookies: [], origins: [] } })`; a test that signs
out or ends other sessions signs in on its own first, so the worker's shared
session lives on. A login state the host supplies is used as it is.

## Application migration

The updater changes package manifests and the lockfile only. It does not
regenerate routes, resources, pages, migrations, or application-owned source.
Review the diff, run the normal database migration command if the selected
release contains database migrations, then run the full application verifier.

For the native assistant action and responsive layout fixes, updating the
packages and lockfile is sufficient. No application regeneration or database
migration is required. Remove temporary app-local action discovery/execution
bridges, JSON:API result transformers, `patch-package` patches, and deep
`.assistant-*` layout overrides that duplicated those framework owners. Keep
the public assistant surface id and normal page composition unchanged.

The release that makes the JSKIT web packages exact Material 3 also changes
app source: the theme, icons, type classes, page titles and parents, and page
actions. [Move an app to the Material 3 defaults](./material-3-migration.md)
lists each change, most of which delete app CSS and overrides.

A release can add message keys (each package's changelog names its new ones,
such as `jskit.auth.local.register.closed`). JSKIT keeps no separate list: in
an app with other locales, run `npx jskit i18n export <locale>` for each one
after updating, which adds every new key in English beside the existing
translations, translate them, and let `npx jskit i18n check <locale>` confirm
none is missing (see [Translation](../framework/translation.md#add-a-language)).
Missing keys fall back to English, so nothing breaks before then, but an app
whose CI runs the check fails until they are added.

Commit `package.json`, every changed workspace manifest, and
`package-lock.json` together. Do not hand-edit one JSKIT version after the
updater succeeds; select a different published cohort only through a catalog
that advertises it.

## Host-only production cookies

In production (`NODE_ENV=production`, served over HTTPS) the session cookies of
the local, Supabase and OIDC auth providers and the CSRF secret cookie use the
`__Host-` prefix, for example `__Host-jskit_local_access_token` and
`__Host-_csrf`. Browsers accept these only with `Secure`, `Path=/` and no
`Domain`, so a sibling subdomain cannot plant or overwrite them. The first
production deploy after updating signs everyone out once. Development and tests
keep the unprefixed names.
Setting `AUTH_CSRF_COOKIE_SECURE=false` keeps the unprefixed CSRF cookie for an
application deliberately served over plain HTTP. CSRF protection is still the
token check on every unsafe request; the prefix only hardens the cookie.

## Read cancellation and deadlines

The standard endpoint, list, view, form-read, and CRUD read composables pass
TanStack Query cancellation to the HTTP client. Superseding or cancelling a
query therefore aborts its obsolete download. Custom query functions must
forward their `signal`, and custom HTTP clients must honor it.

Ordinary `createHttpClient()` and `http-web` `GET`/`HEAD` requests also have a
30-second deadline covering fetch queueing, headers, and JSON body consumption.
This applies even without a caller signal. Set `readTimeoutMs` when configuring
the client, or `timeoutMs` on an individual request, for a different positive
finite integer duration in milliseconds. CSRF session reads use `readTimeoutMs`.
Cancellation and deadline errors are not retried by the transient HTTP client;
the deadline applies per HTTP attempt, not to an entire query/retry lifecycle.
A transient failure of a `GET`/`HEAD` that the client already retried is not
retried again by `shouldRetryTransientQueryFailure`, so the app QueryClient
defaults need no change and an unreachable read makes three requests, not nine.

Writes and `requestStream()` have no default overall deadline. They accept an
explicit `timeoutMs`; long-lived streams still need lifecycle cancellation.
These safeguards do not limit request volume or govern raw `fetch` calls.
