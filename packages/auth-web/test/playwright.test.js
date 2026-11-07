import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { request as playwrightRequest } from "@playwright/test";
import { DEV_AUTH_SECRET_HEADER } from "@jskit-ai/auth-core/server/devAuth";
import { loginAsExistingUser } from "../src/test/playwright.js";

function createResponse({ status = 200, body = {}, url = "" } = {}) {
  return {
    url() {
      return url;
    },
    ok() {
      return status >= 200 && status < 300;
    },
    status() {
      return status;
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function setPlaywrightEnv(context, env) {
  const names = ["PLAYWRIGHT_BASE_URL", "PLAYWRIGHT_PORT"];
  const previous = names.map((name) => [name, process.env[name]]);
  context.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  for (const name of names) {
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
}

test("local Playwright login exchanges CSRF and the private secret in the page context", async (context) => {
  setPlaywrightEnv(context, {});
  const calls = [];
  // As Playwright's request context does, a path alone resolves against the context's baseURL.
  const request = {
    async get(url) {
      calls.push({ method: "GET", url });
      return createResponse({ body: { csrfToken: "csrf-test" }, url: new URL(url, "http://127.0.0.1:4173").href });
    },
    async post(url, options) {
      calls.push({ method: "POST", url, options });
      return createResponse({ body: { ok: true, userId: "7" } });
    }
  };
  const page = {
    context() {
      return { request };
    },
    evaluate() {
      throw new Error("The private exchange must not run in browser JavaScript.");
    }
  };

  const result = await loginAsExistingUser(page, {
    email: "ada@example.com",
    secret: "private-test-secret"
  });

  assert.deepEqual(result, { ok: true, userId: "7" });
  assert.deepEqual(calls, [
    {
      method: "GET",
      url: "/api/session"
    },
    {
      method: "POST",
      url: "http://127.0.0.1:4173/api/dev-auth/login-as",
      options: {
        data: { email: "ada@example.com" },
        headers: {
          "csrf-token": "csrf-test",
          [DEV_AUTH_SECRET_HEADER]: "private-test-secret"
        }
      }
    }
  ]);
});

/** A worker's app server: answers the session and dev-login routes and records what reached it. */
async function workerServer(name) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}${request.headers[DEV_AUTH_SECRET_HEADER] ? " with the secret" : ""}`);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.method === "GET" ? { csrfToken: `csrf-${name}` } : { ok: true, server: name }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { requests, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("each worker signs in on its own server, its context's baseURL, whatever PLAYWRIGHT_PORT says", async (context) => {
  const first = await workerServer("worker 0");
  const second = await workerServer("worker 1");
  // The runner's base port is worker 0's; worker 1's config gives its contexts the next server.
  setPlaywrightEnv(context, { PLAYWRIGHT_PORT: String(first.port) });
  const request = await playwrightRequest.newContext({ baseURL: `http://127.0.0.1:${second.port}` });
  context.after(async () => {
    await request.dispose();
    await Promise.all([first.close(), second.close()]);
  });

  const result = await loginAsExistingUser({ context: () => ({ request }) }, { email: "ada@example.com", secret: "private-test-secret" });

  assert.deepEqual(result, { ok: true, server: "worker 1" });
  assert.deepEqual(second.requests, ["GET /api/session", "POST /api/dev-auth/login-as with the secret"]);
  assert.deepEqual(first.requests, []);
});

test("local Playwright login refuses a managed target before any request when no base URL is given", async (context) => {
  setPlaywrightEnv(context, { PLAYWRIGHT_BASE_URL: "https://preview.example.test" });
  let requestCount = 0;
  const page = { context: () => ({ request: { async get() { requestCount += 1; } } }) };

  await assert.rejects(
    loginAsExistingUser(page, { email: "ada@example.com", secret: "private-test-secret" }),
    /only sends the dev-auth secret to a local app URL/u
  );
  assert.equal(requestCount, 0);
});

test("local Playwright login sends the secret only to a local server that answered the session request", async (context) => {
  setPlaywrightEnv(context, {});
  const posts = [];
  const request = {
    async get(url) {
      return createResponse({ body: { csrfToken: "csrf-test" }, url: new URL(url, "https://app.example.test").href });
    },
    async post(url) {
      posts.push(url);
    }
  };

  await assert.rejects(
    loginAsExistingUser({ context: () => ({ request }) }, { email: "ada@example.com", secret: "private-test-secret" }),
    /only sends the dev-auth secret to a local app URL/u
  );
  assert.deepEqual(posts, []);
});

test("local Playwright login refuses to send the private secret to a managed URL", async () => {
  let requestCount = 0;
  const page = {
    context() {
      return {
        request: {
          async get() {
            requestCount += 1;
          }
        }
      };
    }
  };

  await assert.rejects(
    loginAsExistingUser(page, {
      email: "ada@example.com",
      secret: "private-test-secret",
      baseURL: "https://preview.example.test"
    }),
    /only sends the dev-auth secret to a local app URL/u
  );
  assert.equal(requestCount, 0);
});

test("local Playwright login requires one explicit existing-user identity", async () => {
  let requestCount = 0;
  const page = {
    context() {
      return {
        request: {
          async get() {
            requestCount += 1;
          }
        }
      };
    }
  };

  await assert.rejects(
    loginAsExistingUser(page, { secret: "private-test-secret" }),
    /exactly one of email or userId/u
  );
  assert.equal(requestCount, 0);
});
