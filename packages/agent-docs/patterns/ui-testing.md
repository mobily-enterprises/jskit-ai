# UI Testing Pattern

Use when:

- deciding how to verify a new or changed user-facing screen
- Playwright or browser-driven verification
- authenticated UI flows
- test auth, session bootstrap, dev login-as, or dev auth bypass

Rules:

- Any chunk that adds or changes user-facing UI must include a Playwright flow that exercises the changed behavior before the chunk is done.
- Pattern and framework UI changes must be checked at compact phone, tablet-ish medium, and expanded desktop widths.
- Check horizontal overflow, clipped or invisible text, duplicate navigation, and broken route placement at every standard viewport. On compact screens, also check screen tap targets under 48 px; medium and expanded layouts may use their documented denser controls.
- Apps with `shell-web` installed should start from `tests/e2e/adaptive-shell.spec.ts` and extend it with feature-specific assertions.
- The package helper reads the shell's rendered `data-layout` contract, waits for drawer transitions without fixed sleeps, verifies compact Escape/outside dismissal, checks content-aware drawer fit, and measures rail icon centring against the configured width. Do not replace it with viewport-name assumptions or immediate animation-time geometry reads.
- Start from the application-foundation Playwright configuration and keep it
  app-owned. Do not duplicate base-URL, web-server, or storage-state logic in
  individual tests.
- Use relative paths such as `page.goto("/home")`. The shared config owns the browser base URL.
- A managed runner supplies `PLAYWRIGHT_BASE_URL`. When it is set, JSKIT does not start another app server.
- Vibe64 supplies an authenticated context through `VIBE64_PLAYWRIGHT_STORAGE_STATE`. Treat that file as a temporary secret: do not commit it, print it, or retain it after the run.
- Do not install a browser when the environment provides a managed browser runner.

## Keep startup incremental

Run related cases in one suite invocation. Prepare the isolated database and
fixtures once for that invocation, never once per test. Retain the test schema
and migration ledger, apply only pending migrations, and reset fixture data
deterministically. Restore any migration-owned baseline rows through the test
seed. MySQL applications start from the `database/mysql-application` pattern's
`example/tests/browser/database.js`. Require a repeat-start regression test that
proves unchanged migration history, removal of stale data, pending migration
application, and isolation from the normal database.

Use `BROWSER_TEST_DB_NAME` for that retained schema and a different
`TEST_DB_NAME` for disposable integration and migration tests. Reject a name
collision before connecting. Include disposable cleanup between browser starts
in the regression: one test's teardown must not erase another test's migrations.

Do not drop/recreate the database, replay completed migrations, build every
module fixture, or run a production frontend build for each focused check.
Choose small fixture sets for the selected suite. Fresh-schema migration tests
and production-artifact tests are separate operations. Measure migration,
fixture, and server startup time before retrying a slow launch or raising its
deadline. When a host supplies a managed target, use its scoped suite command so
one startup serves the whole batch and cleanup restores normal Preview.

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
VIBE64_PLAYWRIGHT_STORAGE_STATE=/secure/temp/playwright-state.json \
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

On Vibe64, use `vibe64-playwright --target <declared-test-target> test ...`
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

- the feature changed user-facing UI but no Playwright flow ran
- the Playwright flow skipped the changed behavior itself
- a managed environment was bypassed by installing another browser
- an authenticated flow was left untested without clearly reporting the missing session-bootstrap seam
