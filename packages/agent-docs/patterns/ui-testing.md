# UI Testing Pattern

Use when:

- deciding how to verify a new or changed user-facing screen
- Playwright or browser-driven verification
- authenticated UI flows
- test auth, session bootstrap, dev login-as, or dev auth bypass

Rules:

- Any chunk that adds or changes user-facing UI must include a Playwright flow that exercises the changed behavior before the chunk is done.
- Do not rely on a live external auth provider for Playwright verification of normal app features.
- For authenticated UI in the standard JSKIT auth stack, use the development-only dev auth bypass route instead.
- The standard route is `POST /api/dev-auth/login-as`.
- The request body must include either `{ userId }` or `{ email }`.
- The route is available only when `AUTH_DEV_BYPASS_ENABLED=true` and `AUTH_DEV_BYPASS_SECRET` is set outside production.
- This route must never be enabled in production.
- Because the route is an unsafe POST, fetch `csrfToken` from `/api/session` first and send it back as the `csrf-token` header.
- Make the bootstrap request from the same browser context that will run the assertions so the auth cookies land in the page session.
- Use stable seeded users or fixtures for Playwright. Do not depend on whatever account happens to exist in a developer's browser or external auth provider.

Playwright setup shape:

```ts
await page.goto("/");

await page.evaluate(async ({ email }) => {
  const sessionResponse = await fetch("/api/session", {
    credentials: "include"
  });
  if (!sessionResponse.ok) {
    throw new Error(`Session bootstrap failed: ${sessionResponse.status}`);
  }

  const sessionPayload = await sessionResponse.json();
  const csrfToken = String(sessionPayload?.csrfToken || "");
  if (!csrfToken) {
    throw new Error("Missing csrfToken from /api/session.");
  }

  const loginResponse = await fetch("/api/dev-auth/login-as", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "csrf-token": csrfToken
    },
    body: JSON.stringify({ email })
  });

  if (!loginResponse.ok) {
    throw new Error(`Dev login failed: ${loginResponse.status} ${await loginResponse.text()}`);
  }
}, { email: "ada@example.com" });
```

After that bootstrap:

- navigate to the protected page
- exercise the new UI behavior
- assert the actual outcome the chunk introduced

Do not mark the chunk done if:

- the feature changed user-facing UI but no Playwright flow ran
- the Playwright flow skipped the changed behavior itself
- authenticated UI work was left untested because no local auth bootstrap path was available and that gap was not called out
