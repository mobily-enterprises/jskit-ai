<!-- Generated from `packages/agent-docs/heuristics/ui-testing.md`. -->

# UI Testing Pattern

Use when:

- deciding how to verify a new or changed user-facing screen
- Playwright or browser-driven verification
- authenticated UI flows
- test auth, session bootstrap, dev login-as, or dev auth bypass

Rules:

- Any chunk that adds or changes user-facing UI proves the changed behavior with an automated test before the chunk is done, at the cheapest level that can: a component's content, states and conditional display in a client component test (Vitest); only what needs a real browser (navigation, a flow across screens, layout at the standard widths, focus, the real sign-in) in Playwright.
- Put a new browser check in the existing spec that already reaches that screen with the data it needs. Add a new spec only for a new flow, using the app's shared server, sign-in and fixture setup. A browser test that pays its own server start, sign-in or seeding to check one card, label or state is not acceptable: every run pays for it for as long as it exists. Move that check to a component test or an existing spec, and report the spec's time and the suite's time before and after.
- Never wait out the app's own delays (request retries, debounce, polling) in real time, and never change the scenario to skip them: install Playwright's `page.clock` before the page loads and advance it with `page.clock.runFor(...)`, or use Vitest's fake timers in a component test. Change the scenario only when another test already proves the skipped path.
- Pattern and framework UI changes must be checked at compact phone, tablet-ish medium, and expanded desktop widths.
- Check horizontal overflow, clipped or invisible text, duplicate navigation, and broken route placement at every standard viewport. On compact screens, also check screen tap targets under 48 px; medium and expanded layouts may use their documented denser controls.
- Apps with `shell-web` installed should start from `tests/e2e/adaptive-shell.spec.ts` and extend it with feature-specific assertions.
- The package helper reads the shell's rendered `data-layout` contract, waits for drawer transitions without fixed sleeps, verifies compact Escape/outside dismissal, checks content-aware drawer fit, and measures rail icon centring against the configured width. Do not replace it with viewport-name assumptions or immediate animation-time geometry reads.
- Start from the application-foundation Playwright configuration and keep it
  app-owned. Do not duplicate base-URL, web-server, or storage-state logic in
  individual tests.
- Use relative paths such as `page.goto("/home")`. The shared config owns the browser base URL.
- Find a form field by its exact label: `page.getByLabel("Email", { exact: true })`
  or `page.getByRole("textbox", { name: "Email", exact: true })`. Without
  `exact`, Playwright matches any element whose label contains the text, in any
  case, so "Email" also finds "Confirm email" or any other labelled element that
  mentions emails, and the lookup fails strict mode.
- After clicking a client-side navigation control, wait for its destination
  with `await expect(page).toHaveURL(...)` before reloading. Awaiting the click
  alone does not wait for Vue Router to complete. Up tests reach a page
  through in-app links (one of them sideways), then press
  `pressShellBack(page)` (`@jskit-ai/shell-web/test/shellNavigation`) and
  assert that each Up returns to its origin in order; a direct `page.goto()`
  asserts the declared parent. Do not replace this wait with sleeps.
- A managed runner supplies `PLAYWRIGHT_BASE_URL`. When it is set, JSKIT does not start another app server.
- Otherwise the config starts the app on `PLAYWRIGHT_PORT`, 4173 by default. A runner that shares a machine between runs sets a free port for each run; with one fixed port, a second run would wait for it or reuse another run's server.
- A managed runner may supply an authenticated context through `PLAYWRIGHT_STORAGE_STATE`. Treat that file as a temporary secret: do not commit it, print it, or retain it after the run.
- Do not install a browser when the environment provides a managed browser runner.
- Shared CRUD lists retain both card and table markup and hide the inactive
  layout with CSS. Select visible record text with
  `page.getByText(title, { exact: true }).filter({ visible: true })`; asserting on
  an unfiltered text locator can fail with a strict-mode duplicate after saving.
  Keep the expected text and persistence assertion. If repeated create controls
  perform the same action, select one visible control deliberately rather than
  accepting a different label to make a test pass.
- For CRUD validation, follow the generic CRUD guide's **Browser tests verify
  validation and persistence** example: assert the visible configured error,
  retained form, accepted save and reload persistence. Assert `aria-invalid`
  only when the selected field implements that contract.
- Include the shared list's Search control in the initial feature flow: prove
  matching rows, excluded rows and clearing the query. Raw JSON:API requests
  send `filter[q]`; page-route and internal queries use plain `q`. See the CRUD
  guide's **Wire list search with the initial resource** example.

## Keep startup incremental

Run related cases in one suite invocation. Prepare the isolated database and
fixtures once for that invocation, never once per test. An app's
`playwright.config.mjs` is `browserTestConfig()` from
`@jskit-ai/jskit-catalog/browser-tests`: the production build, made once and
reused while its sources are unchanged, and one server, port and database per
worker. Its `prepare` module (the `database/mysql-application` and
`database/postgres-application` patterns' `example/tests/e2e/databases.js`)
restores each worker's copy of `BROWSER_TEST_DB_NAME` from the stored schema
snapshot and runs the fixture seed, which restores any migration-owned
baseline rows. The migrations are replayed only when one changes, so a second
run reports a stored snapshot, no stale rows, and an unchanged normal
database.

Use `BROWSER_TEST_DB_NAME` for the browser copies and a different
`TEST_DB_NAME` for disposable integration and migration tests; the harness
refuses a collision, or one with the application's database, before
connecting.

Do not replay completed migrations, build every module fixture, or run a
production frontend build for each focused check. A
build made once for a whole run is different: it is the fix when a development
server makes every page load slow, and browser tests never run on the
development server. Choose small fixture sets for the selected
suite; realistic row counts belong in the database tests that compare each
endpoint's query counts. Fresh-schema
migration tests and production-artifact tests are separate operations. Measure
migration, fixture, and server startup time and fix the slow phase; never retry
a slow launch, or raise its deadline or a spec's timeout, to absorb it. A page
that needs a longer timeout to load is a slow endpoint to fix. When a host
supplies a managed target, use its scoped suite command so one startup serves
the whole batch and cleanup restores normal Preview.

## Keep browser evidence focused

Use existing automated cases for repeat verification; reserve interactive
browser exploration for unknown behavior and diagnosis. Batch related actions
and assertions in one test or browser evaluation, returning only the values
needed to assess them. Do not print DOM trees, component state or network
responses wholesale. Inspect the affected region or locator before requesting
a full-page snapshot. Capture screenshots at meaningful visual checkpoints
or failures, not after every click; retain every required viewport check.
Reuse the browser/context when isolation permits, but preserve separate users,
roles and clean contexts where the test depends on them. After a timeout,
inspect the existing failure and resource evidence before a justified rerun.

## Preserve baseline tests

Foundation-pattern baseline tests are app-owned and customizable. Adapt infrastructure
tests in place when routes or behavior change so the baseline coverage remains
truthful.

When the starter product route is replaced, update the scaffold smoke test to
visit and assert the new canonical route. Do not delete baseline browser
coverage such as `tests/e2e/base-shell.spec.ts` or
`tests/e2e/adaptive-shell.spec.ts`.

## Direct local authentication

Use the development-only dev auth bypass when Playwright is talking directly to an app running on localhost.

The app must start with:

```bash
AUTH_DEV_BYPASS_ENABLED=true
AUTH_DEV_BYPASS_SECRET=replace-this-with-a-local-dev-secret
```

The test uses the published Node-side helper:

```ts
import { expect, test } from "@playwright/test";
import { loginAsExistingUser } from "@jskit-ai/auth-web/test/playwright";

test("authenticated feature", async ({ page }) => {
  await loginAsExistingUser(page, { email: "ada@example.com" });
  await page.goto("/w/acme/admin/contacts");
  await expect(page.getByRole("button", { name: "Add contact" })).toBeVisible();
});
```

`loginAsExistingUser()`:

- uses the request client belonging to the same Playwright browser context
- fetches the CSRF token from `GET /api/session`
- sends the CSRF token and private `x-jskit-dev-auth-secret` header to `POST /api/dev-auth/login-as`
- leaves the resulting HTTP-only cookies in that browser context
- refuses to send the secret to a non-local URL

The helper reads `AUTH_DEV_BYPASS_SECRET` from the Playwright Node process by default. Never pass that secret through `page.evaluate()`, browser globals, query parameters, or client-visible environment variables.

The route only selects an existing user. Seed a stable user or fixture before the test. The bypass must never be enabled in production.

## Managed-host authentication

A managed preview must not expose `AUTH_DEV_BYPASS_SECRET` to project code or forward an ordinary browser request to the private login exchange. The host performs its trusted identity exchange outside the application browser context, writes a temporary Playwright storage-state file, and launches the test with:

```bash
PLAYWRIGHT_BASE_URL=https://managed-preview.example.test \
PLAYWRIGHT_STORAGE_STATE=/secure/temp/playwright-state.json \
playwright test tests/e2e/contacts.spec.ts
```

The app-owned config applies that state to Playwright contexts and omits its local `webServer`. Tests then navigate with relative paths and begin with the runner-provided identity already authenticated.

Do not call `loginAsExistingUser()` against a managed preview. It is deliberately localhost-only. An ordinary request to `/api/dev-auth/login-as` without the private exchange header must return `403`.

## Run verification

Run the focused Playwright command and keep the complete output in a local
artifact. Preserve its exit status; a pipe through `tail` must not turn a failed
test into a successful command. For an unmanaged project, for example:

```bash
npx playwright test tests/e2e/contacts.spec.ts -g filters --reporter=dot > /tmp/contacts-test.log 2>&1
```

On a managed host, run the host's launcher for the declared test target
with the same file/case selection and output redirection. Do not replace the
managed launcher with the unmanaged example.

Read a compact summary first: exit status, passed/failed/skipped counts,
duration and artifact paths. On failure, extract the affected case and its
actionable error; expand the matching log or trace only if that evidence is
insufficient. Do not feed whole JSON/TAP reports, passing assertions, HTTP
request logs, screenshots or traces back into agent context. Structured JSON
reports may be captured to a file when needed; parse their result fields rather
than printing the document. A wrapper may append diagnostics after the JSON
object: retain those diagnostics and the original exit status too. Startup,
resource and cleanup failures must remain visible even if assertions passed.
Wait on the same invocation and inspect new output only when it adds evidence;
do not restart tests to recover logs or poll unchanged output repeatedly.

Use the application's relevant focused checks. Do not automatically follow each
browser check with a full lint, build, or test sweep; follow its verification policy.

Do not mark the chunk done if:

- the feature changed user-facing UI but no test at the right level proves it
- the test skipped the changed behavior itself
- a new browser test pays its own setup to check what a component test or an existing spec could
- a managed environment was bypassed by installing another browser
- an authenticated flow was left untested without clearly reporting the missing session-bootstrap seam
