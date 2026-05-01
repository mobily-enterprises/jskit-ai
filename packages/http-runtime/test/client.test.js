import assert from "node:assert/strict";
import test from "node:test";

import { createHttpClient } from "../src/shared/clientRuntime/client.js";

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
    if (url === "/api/session") {
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
  const payload = await client.request("/api/custom", {
    method: "POST",
    body: {
      demo: true
    }
  });

  assert.deepEqual(payload, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "/api/session");
  assert.equal(calls[1][1].headers["csrf-token"], "csrf-a");
  assert.equal(calls[1][1].headers["Content-Type"], "application/json");
  assert.equal(calls[1][1].body, JSON.stringify({ demo: true }));
});

test("request parses json:api responses as json payloads", async () => {
  const fetchImpl = async () =>
    mockResponse({
      contentType: "application/vnd.api+json",
      data: {
        data: {
          type: "contacts",
          id: "2",
          attributes: {
            name: "ddd"
          }
        }
      }
    });

  const client = createHttpClient({ fetchImpl });
  const payload = await client.request("/api/contacts/2");

  assert.deepEqual(payload, {
    data: {
      type: "contacts",
      id: "2",
      attributes: {
        name: "ddd"
      }
    }
  });
});

test("request encodes and decodes json:api resource transport for records", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    if (url === "/api/session") {
      return mockResponse({
        data: {
          csrfToken: "csrf-jsonapi"
        }
      });
    }

    return mockResponse({
      contentType: "application/vnd.api+json",
      data: {
        data: {
          type: "contacts",
          id: "2",
          attributes: {
            name: "ddd",
            subscribed: false
          }
        }
      }
    });
  };

  const client = createHttpClient({ fetchImpl });
  const payload = await client.request("/api/contacts/2", {
    method: "PATCH",
    body: {
      name: "ddd",
      subscribed: false
    },
    transport: {
      kind: "jsonapi-resource",
      requestType: "contact-updates",
      responseType: "contacts",
      responseKind: "record"
    }
  });

  assert.deepEqual(payload, {
    id: "2",
    name: "ddd",
    subscribed: false
  });
  assert.equal(calls[1][1].headers.Accept, "application/vnd.api+json");
  assert.equal(calls[1][1].headers["Content-Type"], "application/vnd.api+json");
  assert.equal(
    calls[1][1].body,
    JSON.stringify({
      data: {
        type: "contact-updates",
        attributes: {
          name: "ddd",
          subscribed: false
        }
      }
    })
  );
});

test("request decodes json:api collection responses into JSKIT paged-list shape", async () => {
  const fetchImpl = async () =>
    mockResponse({
      contentType: "application/vnd.api+json",
      data: {
        data: [
          {
            type: "contacts",
            id: "2",
            attributes: {
              name: "ddd"
            }
          }
        ],
        meta: {
          page: {
            nextCursor: "cursor_2"
          }
        },
        links: {
          next: "/api/contacts?page[cursor]=cursor_2"
        }
      }
    });

  const client = createHttpClient({ fetchImpl });
  const payload = await client.request("/api/contacts", {
    method: "GET",
    transport: {
      kind: "jsonapi-resource",
      responseType: "contacts",
      responseKind: "collection"
    }
  });

  assert.deepEqual(payload, {
    items: [
      {
        id: "2",
        name: "ddd"
      }
    ],
    nextCursor: "cursor_2",
    meta: {
      page: {
        nextCursor: "cursor_2"
      }
    },
    links: {
      next: "/api/contacts?page[cursor]=cursor_2"
    }
  });
});

test("request decodes native json-rest-api collection pagination metadata into JSKIT nextCursor", async () => {
  const fetchImpl = async () =>
    mockResponse({
      contentType: "application/vnd.api+json",
      data: {
        data: [
          {
            type: "contacts",
            id: "2",
            attributes: {
              name: "ddd"
            }
          }
        ],
        meta: {
          pagination: {
            cursor: {
              next: "cursor_2"
            }
          }
        },
        links: {
          next: "/api/contacts?page[after]=cursor_2&page[size]=20"
        }
      }
    });

  const client = createHttpClient({ fetchImpl });
  const payload = await client.request("/api/contacts", {
    method: "GET",
    transport: {
      kind: "jsonapi-resource",
      responseType: "contacts",
      responseKind: "collection"
    }
  });

  assert.deepEqual(payload, {
    items: [
      {
        id: "2",
        name: "ddd"
      }
    ],
    nextCursor: "cursor_2",
    meta: {
      pagination: {
        cursor: {
          next: "cursor_2"
        }
      }
    },
    links: {
      next: "/api/contacts?page[after]=cursor_2&page[size]=20"
    }
  });
});

test("request encodes JSON:API query params for resource collections", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return mockResponse({
      contentType: "application/vnd.api+json",
      data: {
        data: [],
        meta: {
          page: {
            nextCursor: null
          }
        }
      }
    });
  };

  const client = createHttpClient({ fetchImpl });
  await client.request("/api/contacts", {
    method: "GET",
    query: {
      cursor: "cursor_2",
      limit: 10,
      q: "Merc",
      include: "workspace,user",
      workspaceId: "7"
    },
    transport: {
      kind: "jsonapi-resource",
      responseType: "contacts",
      responseKind: "collection"
    }
  });

  assert.equal(
    calls[0],
    "/api/contacts?page%5Bcursor%5D=cursor_2&page%5Blimit%5D=10&filter%5Bq%5D=Merc&include=workspace%2Cuser&filter%5BworkspaceId%5D=7"
  );
});

test("request rejects json:api responses whose primary data type does not match the transport contract", async () => {
  const fetchImpl = async () =>
    mockResponse({
      contentType: "application/vnd.api+json",
      data: {
        data: {
          type: "user-settings",
          id: "2",
          attributes: {
            name: "ddd"
          }
        }
      }
    });

  const client = createHttpClient({ fetchImpl });

  await assert.rejects(
    () =>
      client.request("/api/contacts/2", {
        method: "GET",
        transport: {
          kind: "jsonapi-resource",
          responseType: "contacts",
          responseKind: "record"
        }
      }),
    (error) => {
      assert.equal(error?.message, "JSON:API response decoding failed.");
      assert.equal(error?.cause?.message, "Expected JSON:API resource type contacts, received user-settings.");
      return true;
    }
  );
});

test("request retries once on retryable csrf failure and preserves stateful headers", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    if (url === "/api/session") {
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
    "/api/workspace/projects/1",
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
    "/api/stream",
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

test("requestStream retries once on retryable csrf failure and preserves stateful headers", async () => {
  const calls = [];
  const seenEvents = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    if (url === "/api/session") {
      return mockResponse({
        data: {
          csrfToken: calls.length < 3 ? "csrf-stream-1" : "csrf-stream-2"
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
      contentType: "application/x-ndjson",
      text: '{"type":"done"}\n'
    });
  };

  const client = createHttpClient({
    fetchImpl,
    hooks: {
      decorateHeaders({ headers, state }) {
        state.commandId = state.commandId || "cmd_stream";
        headers["x-command-id"] = state.commandId;
      }
    }
  });

  const state = {};
  await client.requestStream(
    "/api/workspace/stream",
    {
      method: "POST"
    },
    {
      onEvent(event) {
        seenEvents.push(event);
      }
    },
    state
  );

  assert.equal(calls.length, 4);
  assert.equal(calls[1][1].headers["x-command-id"], "cmd_stream");
  assert.equal(calls[3][1].headers["x-command-id"], "cmd_stream");
  assert.equal(calls[1][1].headers["csrf-token"], "csrf-stream-1");
  assert.equal(calls[3][1].headers["csrf-token"], "csrf-stream-2");
  assert.deepEqual(seenEvents, [{ type: "done" }]);
});

test("request maps network errors to normalized transport error", async () => {
  const networkFailure = new Error("offline");
  const fetchImpl = async () => {
    throw networkFailure;
  };

  const client = createHttpClient({ fetchImpl });

  await assert.rejects(
    () => client.request("/api/session"),
    (error) => error.status === 0 && error.message === "Network request failed." && error.cause === networkFailure
  );
});
