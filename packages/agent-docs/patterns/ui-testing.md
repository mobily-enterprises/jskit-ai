# UI Testing Pattern

Use when:

- deciding how to verify a new or changed user-facing screen
- Playwright or browser-driven verification
- authenticated UI flows
- test auth, session bootstrap, dev login-as, or dev auth bypass

Rules:

- Any chunk that adds or changes user-facing UI must include a Playwright flow that exercises the changed behavior before the chunk is done.
- Generator or package template UI changes must be checked at compact phone, tablet-ish medium, and expanded desktop widths.
- For generated UI, check horizontal overflow, clipped or invisible text, duplicate navigation, and broken route placement at every standard viewport. On compact screens, also check generated-screen tap targets under 48 px; medium and expanded layouts may use their documented denser controls.
- Apps with `shell-web` installed should start from `tests/e2e/adaptive-shell.spec.ts` and extend it with feature-specific assertions.
- The package helper reads the shell's rendered `data-layout` contract, waits for drawer transitions without fixed sleeps, verifies compact Escape/outside dismissal, checks content-aware drawer fit, and measures rail icon centring against the configured width. Do not replace it with viewport-name assumptions or immediate animation-time geometry reads.
- Generated `playwright.config.mjs` delegates to `@jskit-ai/jskit-cli/test/playwright`. Do not copy base-URL, web-server, or storage-state logic into app tests.
- Use relative paths such as `page.goto("/home")`. The shared config owns the browser base URL.
- A managed runner supplies `PLAYWRIGHT_BASE_URL`. When it is set, JSKIT does not start another app server.
- Vibe64 supplies an authenticated context through `VIBE64_PLAYWRIGHT_STORAGE_STATE`. Treat that file as a temporary secret: do not commit it, print it, or retain it after the run.
- Do not install a browser when the environment provides a managed browser runner.

## Preserve baseline tests

Generated baseline tests are app-owned and customizable. Adapt infrastructure
tests in place when routes or behavior change so the baseline coverage remains
truthful.

When the starter product route is replaced, update the scaffold smoke test to
visit and assert the new canonical route. Do not delete baseline browser
coverage such as `tests/e2e/base-shell.spec.ts` or
`tests/e2e/adaptive-shell.spec.ts`. JSKIT Doctor must continue to flag a
managed test that is missing.

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
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
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

The generated config applies that state to Playwright contexts and omits its local `webServer`. Tests then navigate with relative paths and begin with the runner-provided identity already authenticated.

Do not call `loginAsExistingUser()` against a managed preview. It is deliberately localhost-only. An ordinary request to `/api/dev-auth/login-as` without the private exchange header must return `403`.

## Run verification

Run the focused Playwright command directly:

```bash
npx playwright test tests/e2e/contacts.spec.ts -g filters
```

For local pre-merge review, follow the focused run with:

```bash
npx jskit doctor --against origin/main
```

Do not mark the chunk done if:

- the feature changed user-facing UI but no Playwright flow ran
- the Playwright flow skipped the changed behavior itself
- a managed environment was bypassed by installing another browser
- an authenticated flow was left untested without clearly reporting the missing session-bootstrap seam
