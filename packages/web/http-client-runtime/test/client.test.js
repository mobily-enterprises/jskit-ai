import assert from "node:assert/strict";
import test from "node:test";

import { createHttpClient } from "../src/client.js";

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

test("request serializes json body and injects csrf token for unsafe methods", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    if (url === "/api/v1/session") {
      return mockResponse({
        data: {
          csrfToken: "csrf-a"
        }
      });
    }

    return mockResponse({
      data: {
        ok: true
      }
    });
  };

  const client = createHttpClient({ fetchImpl });
  const payload = await client.request("/api/v1/custom", {
    method: "POST",
    body: {
      demo: true
    }
  });

  assert.deepEqual(payload, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "/api/v1/session");
  assert.equal(calls[1][1].headers["csrf-token"], "csrf-a");
  assert.equal(calls[1][1].headers["Content-Type"], "application/json");
  assert.equal(calls[1][1].body, JSON.stringify({ demo: true }));
});

test("request retries once on retryable csrf failure and preserves stateful headers", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    if (url === "/api/v1/session") {
      return mockResponse({
        data: {
          csrfToken: calls.length < 3 ? "csrf-1" : "csrf-2"
        }
      });
    }

    if (calls.length === 2) {
      return mockResponse({
        status: 403,
        data: {
          error: "forbidden",
          details: {
            code: "FST_CSRF_INVALID_TOKEN"
          }
        }
      });
    }

    return mockResponse({
      data: {
        ok: true
      }
    });
  };

  const client = createHttpClient({
    fetchImpl,
    hooks: {
      decorateHeaders({ headers, state }) {
        state.commandId = state.commandId || "cmd_shared";
        headers["x-command-id"] = state.commandId;
      }
    }
  });

  const state = {};
  const payload = await client.request(
    "/api/v1/workspace/projects/1",
    {
      method: "PATCH",
      body: {
        name: "Updated"
      }
    },
    state
  );

  assert.deepEqual(payload, { ok: true });
  assert.equal(calls.length, 4);
  assert.equal(calls[1][1].headers["x-command-id"], "cmd_shared");
  assert.equal(calls[3][1].headers["x-command-id"], "cmd_shared");
  assert.equal(calls[1][1].headers["csrf-token"], "csrf-1");
  assert.equal(calls[3][1].headers["csrf-token"], "csrf-2");
});

test("requestStream parses ndjson and supports fallback hook", async () => {
  const encoder = new TextEncoder();
  const response = {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? "text/plain; charset=utf-8" : "";
      }
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"delta","value":"he"}\n'));
        controller.enqueue(encoder.encode('{"type":"done"}\n'));
        controller.close();
      }
    })
  };
  const fetchImpl = async () => response;
  const seenEvents = [];

  const client = createHttpClient({
    fetchImpl,
    hooks: {
      shouldTreatAsNdjsonStream() {
        return true;
      }
    }
  });

  await client.requestStream(
    "/api/v1/stream",
    {
      method: "POST",
      headers: {
        "csrf-token": "provided"
      }
    },
    {
      onEvent(event) {
        seenEvents.push(event);
      }
    }
  );

  assert.deepEqual(seenEvents, [
    { type: "delta", value: "he" },
    { type: "done" }
  ]);
});

test("request maps network errors to normalized transport error", async () => {
  const networkFailure = new Error("offline");
  const fetchImpl = async () => {
    throw networkFailure;
  };

  const client = createHttpClient({ fetchImpl });

  await assert.rejects(
    () => client.request("/api/v1/session"),
    (error) => error.status === 0 && error.message === "Network request failed." && error.cause === networkFailure
  );
});
