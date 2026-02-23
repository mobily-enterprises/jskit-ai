# `@jskit-ai/http-client-runtime`

Shared HTTP transport runtime for frontend SaaS apps.

If you are newer to this topic, read this line first:
This package is the "how requests run" layer. Your app still decides "which endpoint to call" and "what business rule to apply."

---

## Table Of Contents

1. [Who This Is For](#1-who-this-is-for)
2. [What This Package Is For](#2-what-this-package-is-for)
3. [What This Package Does Not Do](#3-what-this-package-does-not-do)
4. [Quick Mental Model](#4-quick-mental-model)
5. [Glossary (Plain Language)](#5-glossary-plain-language)
6. [Install](#6-install)
7. [Quick Start](#7-quick-start)
8. [What Happens During A Request](#8-what-happens-during-a-request)
9. [API Reference (Every Export + Every Client Method)](#9-api-reference-every-export--every-client-method)
10. [Hook Reference (How Apps Customize Behavior)](#10-hook-reference-how-apps-customize-behavior)
11. [How Real Apps Use This Package (And Why)](#11-how-real-apps-use-this-package-and-why)
12. [When To Use / When Not To Use](#12-when-to-use--when-not-to-use)
13. [Common Mistakes](#13-common-mistakes)
14. [Troubleshooting](#14-troubleshooting)
15. [Export Summary](#15-export-summary)

---

## 1) Who This Is For

This README is written for:

1. Developers who are comfortable using API endpoints but are not deeply familiar with transport internals.
2. Developers who need to reuse the same HTTP behavior across multiple apps.
3. Teams that want app-specific policy to stay in apps while sharing request mechanics.

You do not need to know framework internals to use this package.

---

## 2) What This Package Is For

This package gives apps a shared, predictable HTTP runtime with:

1. JSON request execution over `fetch`.
2. CSRF token bootstrap, caching, and one-time retry logic.
3. Normalized error objects for both HTTP failures and network failures.
4. Optional NDJSON streaming support.
5. Hook points so each app can inject its own headers and request lifecycle behavior.

Practical real-world value:

1. You avoid copy-pasting transport helpers in every app.
2. Retry behavior for CSRF failures is consistent everywhere.
3. Error handling code can rely on one shape (`status`, `message`, `details`).
4. You can improve transport behavior once in this package and roll it out to many apps.

---

## 3) What This Package Does Not Do

This package intentionally does not:

1. Define app routes like `workspace.members.invite`.
2. Define app business policy (permissions, billing rules, feature limits).
3. Contain app-specific constants or vocabulary.
4. Depend on UI frameworks (React/Vue/etc.).
5. Show UI messages (toasts, banners).

Why this matters:
Shared packages stay generic; app-specific behavior stays in each app.

---

## 4) Quick Mental Model

Think in three layers:

1. App feature layer: "Invite member", "Update project", "Stream AI reply."
2. App transport adapter layer: app headers, app retry callbacks, app auth handling.
3. `@jskit-ai/http-client-runtime`: generic request engine.

Simple flow:

```text
Feature code -> App transport adapter -> http-client-runtime -> Backend API
```

---

## 5) Glossary (Plain Language)

1. `fetch`: Browser API that sends HTTP requests.
2. HTTP error: Server answered, but status is not OK (`400`, `401`, `403`, `500`...).
3. Network error: Request did not reach or return from server (offline, DNS, blocked connection).
4. CSRF token: Security token sent with "unsafe" write requests.
5. Unsafe methods: Methods that modify data (`POST`, `PUT`, `PATCH`, `DELETE`).
6. NDJSON stream: Response body with one JSON object per line, arriving over time.
7. Hook: App-provided callback that lets your app customize runtime behavior.

---

## 6) Install

In app `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/http-client-runtime": "0.1.0"
  }
}
```

Install from monorepo root:

```bash
npm install
```

---

## 7) Quick Start

```js
import { createHttpClient } from "@jskit-ai/http-client-runtime";

const http = createHttpClient();

const session = await http.get("/api/session");
await http.post("/api/workspace/settings", {
  name: "Acme Workspace"
});
```

Real-life meaning:

1. `get("/api/session")` checks current signed-in session.
2. `post("/api/workspace/settings", ...)` updates workspace config.
3. The runtime handles JSON serialization, CSRF token usage, and normalized errors.

---

## 8) What Happens During A Request

When you call `http.post(...)`, the runtime does this:

1. Normalizes the method (for example `post` -> `POST`).
2. Copies request headers and gives hooks a chance to add app headers.
3. Serializes plain object bodies to JSON and sets `Content-Type` when missing.
4. If method is unsafe and CSRF header is missing, fetches/caches a CSRF token.
5. Sends the request via `fetch`.
6. Parses JSON response safely when response is JSON.
7. If response is an HTTP error:
   1. optionally retries once for CSRF-specific failure codes.
   2. throws a normalized HTTP error if still failing.
8. Calls success/failure hooks with detailed metadata.

Why this is useful:
Every app gets the same safe, predictable request pipeline.

---

## 9) API Reference (Every Export + Every Client Method)

Imports:

```js
import {
  createHttpClient,
  createHttpError,
  createNetworkError,
  DEFAULT_RETRYABLE_CSRF_ERROR_CODES,
  shouldRetryForCsrfFailure,
  normalizeHeaderName,
  hasHeader,
  setHeaderIfMissing
} from "@jskit-ai/http-client-runtime";
```

### `createHttpClient(options?)`

Creates one runtime client instance.

Plain language:
Build this once in your app transport layer, then reuse it for all requests.

Common real-life usage:

```js
const http = createHttpClient({
  csrf: {
    sessionPath: "/api/session",
    headerName: "csrf-token"
  },
  hooks: {
    decorateHeaders({ headers }) {
      headers["x-surface-id"] = "workspace";
    }
  }
});
```

#### `options.fetchImpl`

Type: `Function` (optional)

What it does:
Lets you provide a custom fetch implementation.

Real-life example:

1. In tests, pass a mocked fetch function.
2. In environments without global `fetch`, pass a polyfill.

#### `options.credentials`

Type: `string` (default `"same-origin"`)

What it does:
Controls cookie behavior for requests.

Real-life example:
Most browser SaaS apps keep `"same-origin"` so session cookies are included for app API calls.

#### `options.unsafeMethods`

Type: `string[]` (default `["POST", "PUT", "PATCH", "DELETE"]`)

What it does:
Defines which methods require CSRF token handling.

Real-life example:
If your backend treats `PROPPATCH` as a write method, include it.

#### `options.csrf`

Type:
`{ enabled, sessionPath, headerName, tokenField, retryableErrorCodes }`

What it does:
Configures how CSRF token is loaded, sent, and retried.

Practical meaning of each field:

1. `enabled`: turn CSRF handling on/off.
2. `sessionPath`: endpoint used to obtain fresh CSRF token.
3. `headerName`: request header key used to send token.
4. `tokenField`: JSON field in session response that contains the token.
5. `retryableErrorCodes`: backend error codes that should trigger one retry after token refresh.

Real-life example:
Backend returns `403` with code `FST_CSRF_INVALID_TOKEN`; runtime refreshes token and retries once.

#### `options.hooks`

Type:
`{ decorateHeaders, shouldRetryRequest, onRetryableFailure, onUnauthorized, onSuccess, onFailure, shouldTreatAsNdjsonStream }`

What it does:
Lets app code customize behavior without forking transport logic.

Real-life examples:

1. Add tenant/workspace headers in `decorateHeaders`.
2. Send user to sign-in screen on `onUnauthorized`.
3. Mark realtime commands as failed in `onFailure`.
4. Treat route-specific stream responses as NDJSON in `shouldTreatAsNdjsonStream`.

### `client.request(url, requestOptions?, state?)`

Sends one request and returns parsed response data.

Plain language:
Use this when you need full control over method/options, beyond helper methods like `get` or `post`.

Real-life example:

```js
const payload = await http.request("/api/workspace/invites", {
  method: "POST",
  body: { email: "member@example.com", roleId: "member" }
});
```

Why apps use it:
Feature modules can call a single consistent entrypoint and always get normalized error behavior.

### `client.requestStream(url, requestOptions?, handlers?, state?)`

Runs a streaming request and emits stream events.

Handlers:

1. `onEvent(event)` called for each parsed event.
2. `onMalformedLine(line, error)` called when a stream line is not valid JSON.

Real-life example:

```js
await http.requestStream(
  "/api/workspace/ai/chat/stream",
  {
    method: "POST",
    body: { messageId: "msg_1", input: "Summarize this report." }
  },
  {
    onEvent(event) {
      console.log("AI stream event:", event);
    },
    onMalformedLine(line) {
      console.warn("Bad stream line:", line);
    }
  }
);
```

Why apps use it:
Streaming behavior is centralized, so feature code only handles events.

### `client.ensureCsrfToken(forceRefresh = false)`

Ensures CSRF token is available in memory.

Real-life example:

```js
await http.ensureCsrfToken(true);
```

Why apps use it:
After login/logout or session rotation, forcing refresh avoids stale token usage.

### `client.clearCsrfTokenCache()`

Clears the cached CSRF token.

Real-life example:

```js
function onUserLoggedOut() {
  http.clearCsrfTokenCache();
}
```

Why apps use it:
Prevents old token from being reused after auth boundary changes.

### `client.resetForTests()`

Resets internal runtime state (token cache + in-flight token promise).

Real-life example:

```js
beforeEach(() => {
  http.resetForTests();
});
```

Why apps use it:
Keeps tests isolated and deterministic.

### `client.get(url, options?)`

Shortcut for `request(url, { ...options, method: "GET" })`.

Real-life example:

```js
const settings = await http.get("/api/workspace/settings");
```

Why apps use it:
Most read endpoints are cleaner to call with `get`.

### `client.post(url, body, options?)`

Shortcut for `request(url, { ...options, method: "POST", body })`.

Real-life example:

```js
await http.post("/api/workspace/invites", {
  email: "new.member@example.com",
  roleId: "member"
});
```

Why apps use it:
Common create actions are concise and still get full runtime behavior.

### `client.put(url, body, options?)`

Shortcut for `request(url, { ...options, method: "PUT", body })`.

Real-life example:

```js
await http.put("/api/workspace/projects/42", {
  name: "Project Renamed"
});
```

Why apps use it:
Fits full-resource updates while preserving shared transport semantics.

### `client.patch(url, body, options?)`

Shortcut for `request(url, { ...options, method: "PATCH", body })`.

Real-life example:

```js
await http.patch("/api/workspace/settings", {
  theme: "high-contrast"
});
```

Why apps use it:
Partial updates stay small while still benefiting from CSRF/retry/error normalization.

### `client.delete(url, options?)`

Shortcut for `request(url, { ...options, method: "DELETE" })`.

Real-life example:

```js
await http.delete("/api/workspace/invites/123");
```

Why apps use it:
Delete operations are explicit and consistent with other methods.

### `createHttpError(response, data)`

Creates a normalized error for HTTP failures.

Shape:

1. `message`
2. `status`
3. `fieldErrors`
4. `details`

Real-life example:

```js
const error = createHttpError(
  { status: 403 },
  { error: "Forbidden.", details: { code: "FORBIDDEN" } }
);

if (error.status === 403) {
  // Show "not allowed" UI state
}
```

Why apps use it:
UI and logging code can rely on a stable error format.

### `createNetworkError(cause)`

Creates a normalized error for transport-level failures.

Shape:

1. `message = "Network request failed."`
2. `status = 0`
3. `cause`

Real-life example:

```js
try {
  await http.get("/api/session");
} catch (error) {
  if (error.status === 0) {
    // User may be offline or network is blocked
  }
}
```

Why apps use it:
Separates "backend rejected request" from "request never made it".

### `DEFAULT_RETRYABLE_CSRF_ERROR_CODES`

Default list:

1. `FST_CSRF_INVALID_TOKEN`
2. `FST_CSRF_MISSING_SECRET`

Real-life meaning:
If backend returns these with `403`, one CSRF refresh + retry is usually safe.

### `shouldRetryForCsrfFailure(context)`

Pure helper that decides if a failed request qualifies for CSRF retry.

Real-life example:

```js
const shouldRetry = shouldRetryForCsrfFailure({
  response: { status: 403 },
  method: "POST",
  state: { csrfRetried: false },
  data: { details: { code: "FST_CSRF_INVALID_TOKEN" } },
  unsafeMethods: new Set(["POST", "PUT", "PATCH", "DELETE"])
});
```

Why apps use it:
Useful in tests or if custom retry logic needs the same decision rules.

### `normalizeHeaderName(name)`

Returns normalized lowercase header name for case-insensitive comparison.

Real-life example:

```js
normalizeHeaderName(" Content-Type "); // "content-type"
```

Why apps use it:
Header keys arrive in mixed case in real-world integrations.

### `hasHeader(headers, name)`

Checks if a headers object already has a header (case-insensitive).

Real-life example:

```js
hasHeader({ "content-type": "application/json" }, "Content-Type"); // true
```

Why apps use it:
Prevents accidental duplicate header writes.

### `setHeaderIfMissing(headers, name, value)`

Sets a header only if that header is not already present (case-insensitive).

Real-life example:

```js
const headers = { "content-type": "application/json" };
setHeaderIfMissing(headers, "Content-Type", "text/plain");
// headers["content-type"] remains "application/json"
```

Why apps use it:
Respects caller intent while still applying defaults safely.

---

## 10) Hook Reference (How Apps Customize Behavior)

All hooks are optional. Use only what your app needs.

### `hooks.decorateHeaders(context)`

When it runs:
Before every request is sent.

Use it for:
Adding app-specific headers.

Real-life example:

```js
decorateHeaders({ headers, state, url, method }) {
  headers["x-surface-id"] = "workspace";
  headers["x-workspace-slug"] = "acme";

  if (method === "POST" && url.startsWith("/api/workspace/")) {
    state.commandContext = { source: "workspace-ui" };
  }
}
```

### `hooks.shouldRetryRequest(context)`

When it runs:
After a failed response, before retry decision.

Use it for:
Overriding default retry rules.

Real-life example:

```js
shouldRetryRequest({ response, method, state, data }) {
  if (response.status !== 403) {
    return false;
  }

  return method === "POST" && data?.details?.code === "FST_CSRF_INVALID_TOKEN" && !state.csrfRetried;
}
```

### `hooks.onRetryableFailure(context)`

When it runs:
Right before retry is performed.

Use it for:
Audit logs or internal metrics.

Real-life example:

```js
onRetryableFailure({ method, response, data }) {
  console.info("Retrying request after CSRF failure", {
    method,
    status: response.status,
    code: data?.details?.code
  });
}
```

### `hooks.onUnauthorized(error)`

When it runs:
On HTTP `401` before failure is thrown.

Use it for:
Auth redirects or session-reset flows.

Real-life example:

```js
onUnauthorized() {
  window.location.assign("/login");
}
```

### `hooks.onSuccess(context)`

When it runs:
After successful request/stream completion.

Use it for:
App-specific success bookkeeping.

Real-life example:

```js
onSuccess({ state }) {
  if (state.commandContext?.tracked) {
    // mark command as acknowledged
  }
}
```

### `hooks.onFailure(context)`

When it runs:
When request/stream fails for any reason (`network_error`, `http_403`, `stream_error`, `aborted`, etc.).

Use it for:
Metrics, realtime command failure bookkeeping, centralized logging.

Real-life example:

```js
onFailure({ reason, state }) {
  if (state.commandContext?.tracked) {
    console.warn("Command failed", reason);
  }
}
```

### `hooks.shouldTreatAsNdjsonStream(context)`

When it runs:
For stream requests when content type is not already `application/x-ndjson`.

Use it for:
Route-specific stream fallback logic.

Real-life example:

```js
shouldTreatAsNdjsonStream({ url, contentType, isJson, response }) {
  return (
    url.includes("/api/workspace/ai/chat/stream") &&
    !contentType.includes("application/x-ndjson") &&
    !isJson &&
    response?.body &&
    typeof response.body.getReader === "function"
  );
}
```

---

## 11) How Real Apps Use This Package (And Why)

Typical structure in an app:

1. Create one app-local transport adapter file.
2. Instantiate `createHttpClient(...)` there.
3. Add app-specific headers and lifecycle logic through hooks.
4. Export `request` and `requestStream` wrappers for the rest of the app.
5. Keep endpoint-specific modules app-local.

In this repo:
`apps/jskit-value-app/src/services/api/transport.js` uses this package as runtime core.

Real app behaviors implemented there:

1. Add `x-surface-id` and `x-workspace-slug` headers from route context.
2. Attach `x-command-id` and `x-client-id` for selected realtime-correlated write routes.
3. Mark commands as acked/failed in hooks (`onSuccess`, `onFailure`).
4. Treat AI stream endpoint as NDJSON-like stream even when content type fallback is needed.

Why this split is important:

1. Shared package stays neutral and reusable.
2. App keeps full control of domain-specific behavior.
3. New apps can reuse runtime and provide different hooks.

---

## 12) When To Use / When Not To Use

Use this package when:

1. You have multiple apps that should share request behavior.
2. You want consistent CSRF retry semantics.
3. You want one normalized error model.
4. You need optional stream parsing support.

Do not use this package alone when:

1. You need endpoint-specific business workflows.
2. You need app policy decisions (roles, entitlements, billing rules).
3. You need UI layer concerns (toast notifications, modal flows).

---

## 13) Common Mistakes

1. Putting app-specific endpoint constants inside this shared package.
2. Adding unlimited retries (can create loops and load spikes).
3. Throwing raw `fetch` errors instead of normalized errors.
4. Mixing UI side effects directly into transport internals.
5. Forgetting to clear CSRF cache on auth state changes.

---

## 14) Troubleshooting

### Requests fail with `403` even after retry

Check:

1. Backend actually returns one of configured retryable CSRF codes.
2. Session endpoint returns a valid token field (`csrfToken` by default).
3. `csrf.headerName` matches backend expectation.

### Stream endpoint returns no events

Check:

1. Stream handler includes `onEvent`.
2. Backend emits valid JSON lines.
3. If content type is not NDJSON, implement `shouldTreatAsNdjsonStream`.

### Headers are missing

Check:

1. `decorateHeaders` is configured.
2. You mutate the provided `headers` object directly.
3. Route/method conditions in your hook actually match the request.

### Tests are flaky around CSRF token state

Check:

1. Call `http.resetForTests()` in `beforeEach`.
2. Avoid sharing runtime client instance across unrelated test suites.

---

## 15) Export Summary

From `@jskit-ai/http-client-runtime`:

1. `createHttpClient`
2. `createHttpError`
3. `createNetworkError`
4. `DEFAULT_RETRYABLE_CSRF_ERROR_CODES`
5. `shouldRetryForCsrfFailure`
6. `normalizeHeaderName`
7. `hasHeader`
8. `setHeaderIfMissing`
