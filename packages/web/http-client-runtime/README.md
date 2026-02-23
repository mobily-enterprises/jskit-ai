# `@jskit-ai/http-client-runtime`

Shared frontend HTTP transport runtime for SaaS apps.

This package gives you a reusable, app-agnostic core for:

1. JSON request execution over `fetch`.
2. CSRF token bootstrap/cache/retry behavior.
3. Standardized HTTP/network error objects.
4. Optional NDJSON stream parsing.
5. Hook-based header injection and request lifecycle callbacks.

It intentionally does not:

1. Define app endpoints.
2. Define app-specific permissions or business rules.
3. Depend on Vue/React/Fastify.
4. Define UI notifications/toasts.

If you are newer to this topic:

1. Think of this package as the app’s "HTTP engine."
2. Your app still defines *where* to call (`/api/...`) and *why*.
3. This package standardizes *how* calls are executed.

---

## 1) What This Package Is For

Use this package when you want multiple apps to share transport behavior (headers, CSRF, retry, error shape) without duplicating that logic.

Practical value:

1. No copy-paste HTTP helper drift across apps.
2. CSRF retry semantics are consistent.
3. Error handling code can rely on one stable shape.
4. You can add transport improvements once and roll them out by package version updates.

What stays app-local:

1. Endpoint wrappers (`api.workspace.list`, `api.billing.createCheckout`, etc.).
2. App-specific headers (`x-surface-id`, `x-command-id`, etc.) via hooks.
3. App-specific stream fallback rules via hooks.

---

## 2) Installation (Workspace Monorepo)

In app `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/http-client-runtime": "0.1.0"
  }
}
```

Then install from repo root:

```bash
npm install
```

---

## 3) Quick Start

```js
import { createHttpClient } from "@jskit-ai/http-client-runtime";

const http = createHttpClient();
const session = await http.get("/api/session");
```

POST with automatic JSON serialization and CSRF handling:

```js
const result = await http.post("/api/workspace/settings", {
  name: "Acme Workspace"
});
```

---

## 4) Full API Reference

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

Creates and returns a transport client.

Plain English:
Create one reusable HTTP runtime instance for your app.

Core options:

1. `fetchImpl?: Function` (default global `fetch`)
2. `credentials?: string` (default `"same-origin"`)
3. `unsafeMethods?: string[]` (default `["POST", "PUT", "PATCH", "DELETE"]`)
4. `csrf?: { enabled, sessionPath, headerName, tokenField, retryableErrorCodes }`
5. `hooks?: { decorateHeaders, shouldRetryRequest, onRetryableFailure, onUnauthorized, onSuccess, onFailure, shouldTreatAsNdjsonStream }`

Real example:

```js
const http = createHttpClient({
  csrf: {
    sessionPath: "/api/session",
    headerName: "csrf-token"
  },
  hooks: {
    decorateHeaders({ headers }) {
      headers["x-surface-id"] = "app";
    }
  }
});
```

Why this matters:
The runtime stays generic while app-specific behavior is injected through hooks.

### `client.request(url, requestOptions?, state?)`

Executes a standard request and returns parsed JSON payload (or `{}` for non-JSON).

Behavior:

1. Normalizes method to uppercase.
2. Serializes object body to JSON (except `FormData`).
3. Auto-fetches CSRF token for unsafe methods if missing.
4. Retries once for configured CSRF failure codes.
5. Throws normalized HTTP or network errors.

Real example:

```js
const payload = await http.request("/api/workspace/invites", {
  method: "POST",
  body: { email: "member@example.com", roleId: "member" }
});
```

Why this matters:
All apps get consistent request mechanics and error semantics.

### `client.requestStream(url, requestOptions?, handlers?, state?)`

Executes a streaming request and emits parsed events.

Handlers:

1. `onEvent(event)`
2. `onMalformedLine(line, error)`

Behavior:

1. Supports NDJSON parsing (`application/x-ndjson`).
2. Can use hook fallback (`shouldTreatAsNdjsonStream`) for custom stream routes/content-types.
3. Uses same CSRF/retry logic as `request`.
4. Throws normalized errors for HTTP/network failures.

Real example:

```js
await http.requestStream(
  "/api/workspace/ai/chat/stream",
  {
    method: "POST",
    body: { messageId: "msg_1", input: "hello" }
  },
  {
    onEvent(event) {
      console.log(event);
    }
  }
);
```

Why this matters:
You can keep stream parsing logic centralized and deterministic.

### `client.ensureCsrfToken(forceRefresh = false)`

Ensures a CSRF token is available (using configured session endpoint).

Behavior:

1. Uses in-memory cache unless `forceRefresh` is `true`.
2. De-duplicates in-flight token fetches.
3. Throws normalized network/HTTP errors when bootstrap fails.

Real example:

```js
const token = await http.ensureCsrfToken(true);
```

Why this matters:
Apps can explicitly refresh token state after auth/session transitions.

### `client.clearCsrfTokenCache()`

Clears in-memory CSRF token cache.

Real example:

```js
api.clearCsrfTokenCache();
```

Why this matters:
Useful on logout/login transitions to avoid stale token reuse.

### `client.resetForTests()`

Resets runtime internal state (CSRF cache + in-flight CSRF promise).

Real example:

```js
beforeEach(() => {
  http.resetForTests();
});
```

Why this matters:
Tests stay deterministic and isolated.

### `client.get(url, options?)`

Shortcut for `request(url, { ...options, method: "GET" })`.

Real example:

```js
const settings = await http.get("/api/workspace/settings");
```

### `client.post(url, body, options?)`

Shortcut for `request(url, { ...options, method: "POST", body })`.

Real example:

```js
await http.post("/api/workspace/invites", { email: "new@user.com" });
```

### `client.put(url, body, options?)`

Shortcut for `request(url, { ...options, method: "PUT", body })`.

Real example:

```js
await http.put("/api/workspace/projects/42", { name: "Project Renamed" });
```

### `client.patch(url, body, options?)`

Shortcut for `request(url, { ...options, method: "PATCH", body })`.

Real example:

```js
await http.patch("/api/workspace/settings", { color: "#ff00aa" });
```

### `client.delete(url, options?)`

Shortcut for `request(url, { ...options, method: "DELETE" })`.

Real example:

```js
await http.delete("/api/workspace/invites/123");
```

### `createHttpError(response, data)`

Builds normalized HTTP error object.

Output fields:

1. `message`
2. `status`
3. `fieldErrors`
4. `details`

Real example:

```js
const error = createHttpError({ status: 403 }, { error: "Forbidden.", details: { code: "FORBIDDEN" } });
// error.status === 403
```

### `createNetworkError(cause)`

Builds normalized transport/network error.

Output fields:

1. `message = "Network request failed."`
2. `status = 0`
3. `cause`

Real example:

```js
try {
  await http.get("/api/session");
} catch (error) {
  if (error.status === 0) {
    // offline / network-level failure
  }
}
```

### `DEFAULT_RETRYABLE_CSRF_ERROR_CODES`

Default CSRF retry code list:

1. `FST_CSRF_INVALID_TOKEN`
2. `FST_CSRF_MISSING_SECRET`

### `shouldRetryForCsrfFailure(context)`

Helper for deciding whether a failed request should retry due to CSRF failure.

Real example:

```js
const shouldRetry = shouldRetryForCsrfFailure({
  response: { status: 403 },
  method: "POST",
  state: { csrfRetried: false },
  data: { details: { code: "FST_CSRF_INVALID_TOKEN" } },
  unsafeMethods: new Set(["POST", "PUT", "PATCH", "DELETE"])
});
```

### `normalizeHeaderName(name)`

Normalizes header name for case-insensitive comparisons.

Real example:

```js
normalizeHeaderName(" Content-Type "); // "content-type"
```

### `hasHeader(headers, name)`

Case-insensitive header existence check.

Real example:

```js
hasHeader({ "content-type": "application/json" }, "Content-Type"); // true
```

### `setHeaderIfMissing(headers, name, value)`

Sets header only when not already present (case-insensitive).

Real example:

```js
const headers = { "content-type": "application/json" };
setHeaderIfMissing(headers, "Content-Type", "text/plain");
// header remains application/json
```

---

## 5) How Apps Use This In Real Terms (and Why)

Typical integration approach:

1. Build one app-local transport adapter.
2. Use hooks to inject app headers and lifecycle behavior.
3. Export app-specific `request` / `requestStream` wrappers.
4. Keep endpoint wrappers app-local (`authApi`, `workspaceApi`, etc.).

In this repo:

1. `apps/jskit-value-app/src/services/api/transport.js` uses this package as runtime core.
2. The app adapter adds:
   - surface/workspace headers
   - realtime command-correlation headers
   - command tracker ack/failure finalization

Why this split matters:

1. Shared package remains domain-neutral.
2. App retains full control of policy-specific headers and behavior.
3. Future apps can reuse runtime with different hooks.

---

## 6) Recommended Integration Pattern

1. Instantiate one client per browser runtime.
2. Keep hooks small and deterministic.
3. Put endpoint path wrappers in app-local files.
4. Keep request retry policy explicit and bounded (one retry for CSRF).
5. Use `resetForTests()` in test setup.

---

## 7) Common Mistakes To Avoid

1. Hardcoding app-specific endpoints inside this package.
2. Adding unbounded retry loops.
3. Mixing UI toast behavior into transport hooks.
4. Skipping error normalization and throwing raw fetch failures.
5. Forgetting to clear CSRF cache on auth boundary changes.

---

## 8) Troubleshooting

### "Request failed with status 403" after retry

Check:

1. Server returns retryable CSRF code on first failure.
2. Session endpoint returns fresh CSRF token.
3. `csrf.headerName` matches backend expectation.

### Stream endpoint returns text/plain and no events

Check:

1. Implement `hooks.shouldTreatAsNdjsonStream`.
2. Ensure response body is readable stream and lines are valid JSON.

### Headers missing on requests

Check:

1. `hooks.decorateHeaders` is configured.
2. Hook mutates the provided `headers` object directly.

---

## 9) Short End-to-End Example

```js
import { createHttpClient } from "@jskit-ai/http-client-runtime";

const http = createHttpClient({
  hooks: {
    decorateHeaders({ headers }) {
      headers["x-surface-id"] = "admin";
    }
  }
});

const projects = await http.get("/api/workspace/projects?page=1&pageSize=20");

await http.post("/api/workspace/projects", {
  name: "New Project"
});
```

---

## 10) Export Summary

From `@jskit-ai/http-client-runtime`:

1. `createHttpClient`
2. `createHttpError`
3. `createNetworkError`
4. `DEFAULT_RETRYABLE_CSRF_ERROR_CODES`
5. `shouldRetryForCsrfFailure`
6. `normalizeHeaderName`
7. `hasHeader`
8. `setHeaderIfMissing`
