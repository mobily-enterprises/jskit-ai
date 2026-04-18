import assert from "node:assert/strict";
import test from "node:test";

import { createTransientRetryHttpClient } from "../src/client/index.js";

function mockResponse({ status = 200, data = {}, contentType = "application/json; charset=utf-8", text = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? contentType : "";
      }
    },
    async json() {
      return data;
    },
    async text() {
      return text;
    }
  };
}

async function withImmediateTimers(executor) {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (handler, _delay, ...args) => {
    if (typeof handler === "function") {
      handler(...args);
    }
    return 0;
  };

  try {
    return await executor();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

test("createTransientRetryHttpClient retries transient GET request failures", async () => {
  await withImmediateTimers(async () => {
    let callCount = 0;
    const client = createTransientRetryHttpClient({
      fetchImpl: async () => {
        callCount += 1;
        if (callCount < 3) {
          return mockResponse({
            status: 503,
            data: {
              error: "temporarily unavailable"
            }
          });
        }

        return mockResponse({
          data: {
            ok: true
          }
        });
      }
    });

    const payload = await client.request("/api/demo", {
      method: "GET"
    });

    assert.deepEqual(payload, { ok: true });
    assert.equal(callCount, 3);
  });
});

test("createTransientRetryHttpClient does not retry unsafe transient failures", async () => {
  await withImmediateTimers(async () => {
    let callCount = 0;
    const client = createTransientRetryHttpClient({
      fetchImpl: async (url) => {
        callCount += 1;
        if (url === "/api/session") {
          return mockResponse({
            data: {
              csrfToken: "csrf-1"
            }
          });
        }

        return mockResponse({
          status: 503,
          data: {
            error: "temporarily unavailable"
          }
        });
      }
    });

    await assert.rejects(
      client.request("/api/demo", {
        method: "POST",
        body: {
          ok: true
        }
      }),
      (error) => {
        assert.equal(error?.status, 503);
        return true;
      }
    );

    assert.equal(callCount, 2);
  });
});

test("createTransientRetryHttpClient retries transient GET stream failures", async () => {
  await withImmediateTimers(async () => {
    let callCount = 0;
    const client = createTransientRetryHttpClient({
      fetchImpl: async () => {
        callCount += 1;
        if (callCount === 1) {
          return mockResponse({
            status: 503,
            data: {
              error: "temporarily unavailable"
            }
          });
        }

        return mockResponse({
          contentType: "text/plain; charset=utf-8",
          text: ""
        });
      }
    });

    await client.requestStream("/api/demo-stream", {
      method: "GET"
    });

    assert.equal(callCount, 2);
  });
});
