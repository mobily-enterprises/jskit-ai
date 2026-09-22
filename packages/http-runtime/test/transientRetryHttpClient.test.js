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

test("createTransientRetryHttpClient resolves request urls before fetch", async () => {
  const calls = [];
  const client = createTransientRetryHttpClient({
    csrf: {
      enabled: false
    },
    resolveRequestUrl(url) {
      return url.replace(/^\/api\//u, "/api/app/beepollen/");
    },
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return mockResponse({
        data: {
          ok: true
        }
      });
    }
  });

  const payload = await client.request("/api/vibe64/sessions", {
    method: "GET"
  });

  assert.deepEqual(payload, { ok: true });
  assert.equal(calls[0][0], "/api/app/beepollen/vibe64/sessions");
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

for (const phase of ["before request", "waiting for headers", "reading body", "retry delay"]) {
  test(`request cancellation during ${phase} rejects without starting another fetch`, async () => {
    await withImmediateTimers(async () => {
      const controller = new AbortController();
      const reason = new DOMException("Read superseded", "AbortError");
      let callCount = 0;
      const client = createTransientRetryHttpClient({
        fetchImpl: async (_url, { signal }) => {
          callCount += 1;
          if (phase === "before request") signal.throwIfAborted();
          if (phase === "waiting for headers") {
            controller.abort(reason);
            signal.throwIfAborted();
          }
          if (phase === "reading body") {
            return {
              ...mockResponse(),
              async json() {
                controller.abort(reason);
                signal.throwIfAborted();
              }
            };
          }
          return mockResponse({ status: 503 });
        }
      });
      const immediateTimer = globalThis.setTimeout;
      if (phase === "before request") controller.abort(reason);
      if (phase === "retry delay") {
        globalThis.setTimeout = (handler, delay, ...args) => {
          controller.abort(reason);
          return immediateTimer(handler, delay, ...args);
        };
      }
      await assert.rejects(client.request("/api/cancellation", { signal: controller.signal }),
        (error) => error === reason);
      assert.equal(callCount, phase === "before request" ? 0 : 1);
    });
  });
}

for (const phase of ["headers", "body"]) {
  test(`default read deadline during ${phase} rejects without a caller signal or another fetch`, async (t) => {
    await withImmediateTimers(async () => {
      const deadline = new AbortController();
      const reason = new DOMException("Read timed out", "TimeoutError");
      t.mock.method(AbortSignal, "timeout", () => deadline.signal);
      let callCount = 0;
      const client = createTransientRetryHttpClient({
        fetchImpl: async () => {
          callCount += 1;
          if (phase === "headers") {
            deadline.abort(reason);
            throw reason;
          }
          return {
            ...mockResponse(),
            async json() {
              deadline.abort(reason);
              throw new DOMException("Body read aborted", "AbortError");
            }
          };
        }
      });
      await assert.rejects(client.request("/api/forgotten-read"), (error) => error === reason);
      assert.equal(callCount, 1);
    });
  });
}
