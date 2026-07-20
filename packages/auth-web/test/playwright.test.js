import assert from "node:assert/strict";
import test from "node:test";
import { DEV_AUTH_SECRET_HEADER } from "@jskit-ai/auth-core/server/devAuth";
import { loginAsExistingUser } from "../src/test/playwright.js";

function createResponse({ status = 200, body = {} } = {}) {
  return {
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

test("local Playwright login exchanges CSRF and the private secret in the page context", async () => {
  const calls = [];
  const request = {
    async get(url) {
      calls.push({ method: "GET", url });
      return createResponse({ body: { csrfToken: "csrf-test" } });
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
      url: "http://127.0.0.1:4173/api/session"
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
