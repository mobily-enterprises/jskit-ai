import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildStreamEventError, createApi } from "../../src/services/api/aiApi.js";
import { __testables } from "../../src/services/api/transport.js";

function createNdjsonResponse(chunks, { status = 200, contentType = "application/x-ndjson; charset=utf-8" } = {}) {
  const encoder = new TextEncoder();

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: vi.fn((name) => {
        const key = String(name || "").toLowerCase();
        if (key === "content-type") {
          return contentType;
        }
        return "";
      })
    },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    })
  };
}

describe("ai api stream client", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    __testables.resetApiStateForTests();
  });

  it("aiApi wrapper delegates to requestStream with expected route", async () => {
    const requestStream = vi.fn(async () => undefined);
    const api = createApi({ requestStream });

    await api.streamChat(
      {
        messageId: "msg_1",
        input: "hello"
      },
      {
        signal: null,
        onEvent: () => {}
      }
    );

    expect(requestStream).toHaveBeenCalledWith(
      "/api/workspace/ai/chat/stream",
      {
        method: "POST",
        body: {
          messageId: "msg_1",
          input: "hello"
        },
        signal: null
      },
      {
        onEvent: expect.any(Function),
        onMalformedLine: undefined
      }
    );
  });

  it("aiApi wrapper rejects when stream emits error event by default", async () => {
    const requestStream = vi.fn(async (_url, _options, handlers) => {
      handlers.onEvent({
        type: "error",
        code: "provider_error",
        message: "AI provider request failed.",
        status: 502
      });
      handlers.onEvent({
        type: "done",
        messageId: "msg_1"
      });
    });
    const api = createApi({ requestStream });

    await expect(
      api.streamChat({
        messageId: "msg_1",
        input: "hello"
      })
    ).rejects.toMatchObject({
      message: "AI provider request failed.",
      code: "provider_error",
      status: 502
    });
  });

  it("aiApi wrapper can disable error-event rejection", async () => {
    const requestStream = vi.fn(async (_url, _options, handlers) => {
      handlers.onEvent({
        type: "error",
        code: "provider_error",
        message: "AI provider request failed.",
        status: 502
      });
    });
    const api = createApi({ requestStream });
    const seen = [];

    await expect(
      api.streamChat(
        {
          messageId: "msg_2",
          input: "hello"
        },
        {
          rejectOnErrorEvent: false,
          onEvent(event) {
            seen.push(event);
          }
        }
      )
    ).resolves.toBeUndefined();
    expect(seen).toEqual([
      {
        type: "error",
        code: "provider_error",
        message: "AI provider request failed.",
        status: 502
      }
    ]);
  });

  it("buildStreamEventError normalizes stream error payload", () => {
    const error = buildStreamEventError({
      type: "error",
      code: "forbidden",
      message: "Forbidden.",
      status: 403
    });

    expect(error.message).toBe("Forbidden.");
    expect(error.code).toBe("forbidden");
    expect(error.status).toBe(403);
    expect(error.event).toEqual({
      type: "error",
      code: "forbidden",
      message: "Forbidden.",
      status: 403
    });
  });

  it("parses NDJSON events across chunk boundaries", async () => {
    const onEvent = vi.fn();

    global.fetch.mockResolvedValueOnce(
      createNdjsonResponse(['{"type":"assistant_delta","delta":"Hel', 'lo"}\n{"type":"done"}\n'])
    );

    await __testables.requestStream(
      "/api/workspace/ai/chat/stream",
      {
        method: "POST",
        headers: {
          "csrf-token": "token"
        },
        body: {
          messageId: "msg_2",
          input: "hello"
        }
      },
      {
        onEvent
      }
    );

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[0][0]).toEqual({
      type: "assistant_delta",
      delta: "Hello"
    });
    expect(onEvent.mock.calls[1][0]).toEqual({
      type: "done"
    });
  });

  it("parses AI stream lines even when content-type is not ndjson", async () => {
    const onEvent = vi.fn();

    global.fetch.mockResolvedValueOnce(
      createNdjsonResponse(['{"type":"assistant_delta","delta":"He"}\n', '{"type":"assistant_delta","delta":"llo"}\n{"type":"done"}\n'], {
        contentType: "text/plain; charset=utf-8"
      })
    );

    await __testables.requestStream(
      "/api/workspace/ai/chat/stream",
      {
        method: "POST",
        headers: {
          "csrf-token": "token"
        },
        body: {
          messageId: "msg_stream_fallback",
          input: "hello"
        }
      },
      {
        onEvent
      }
    );

    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onEvent.mock.calls[0][0]).toEqual({
      type: "assistant_delta",
      delta: "He"
    });
    expect(onEvent.mock.calls[1][0]).toEqual({
      type: "assistant_delta",
      delta: "llo"
    });
    expect(onEvent.mock.calls[2][0]).toEqual({
      type: "done"
    });
  });

  it("does not attach realtime command-correlation headers for ai streaming route", async () => {
    window.history.replaceState({}, "", "/w/acme/assistant");
    global.fetch.mockResolvedValueOnce(createNdjsonResponse(['{"type":"done"}\n']));

    await __testables.requestStream(
      "/api/workspace/ai/chat/stream",
      {
        method: "POST",
        headers: {
          "csrf-token": "token"
        },
        body: {
          messageId: "msg_headers",
          input: "hello"
        }
      },
      {
        onEvent: () => {}
      }
    );

    const requestHeaders = global.fetch.mock.calls[0][1].headers;
    expect(requestHeaders["x-surface-id"]).toBe("app");
    expect(requestHeaders["x-workspace-slug"]).toBe("acme");
    expect(requestHeaders["x-command-id"]).toBeUndefined();
    expect(requestHeaders["x-client-id"]).toBeUndefined();
  });

  it("ignores malformed NDJSON lines and reports malformed callbacks", async () => {
    const onEvent = vi.fn();
    const onMalformedLine = vi.fn();

    global.fetch.mockResolvedValueOnce(
      createNdjsonResponse(['{"type":"assistant_delta"}\nnot-json\n{"type":"done"}\n'])
    );

    await __testables.requestStream(
      "/api/workspace/ai/chat/stream",
      {
        method: "POST",
        headers: {
          "csrf-token": "token"
        },
        body: {
          messageId: "msg_3",
          input: "hello"
        }
      },
      {
        onEvent,
        onMalformedLine
      }
    );

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onMalformedLine).toHaveBeenCalledTimes(1);
    expect(onMalformedLine.mock.calls[0][0]).toBe("not-json");
  });

  it("supports canceling a streaming request", async () => {
    const abortController = new AbortController();

    global.fetch.mockImplementationOnce((_url, config) => {
      return new Promise((_, reject) => {
        config.signal.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    const streamPromise = __testables.requestStream(
      "/api/workspace/ai/chat/stream",
      {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "csrf-token": "token"
        },
        body: {
          messageId: "msg_4",
          input: "hello"
        }
      },
      {
        onEvent: () => {}
      }
    );

    abortController.abort();

    await expect(streamPromise).rejects.toMatchObject({
      name: "AbortError"
    });
  });
});
