import test from "node:test";
import assert from "node:assert/strict";
import { buildStreamEventError, createApi } from "../src/assistantApi.js";

test("assistantApi streamChat rejects on error event by default", async () => {
  const api = createApi({
    request: async () => ({}),
    requestStream: async (_url, _options, handlers) => {
      handlers.onEvent({
        type: "error",
        code: "provider_error",
        message: "Provider failed",
        status: 502
      });
    }
  });

  await assert.rejects(
    () =>
      api.streamChat({
        messageId: "msg_1",
        input: "hello"
      }),
    {
      message: "Provider failed",
      code: "provider_error",
      status: 502
    }
  );
});

test("assistantApi streamChat can ignore error events when configured", async () => {
  const seenEvents = [];
  const api = createApi({
    request: async () => ({}),
    requestStream: async (_url, _options, handlers) => {
      handlers.onEvent({
        type: "error",
        code: "provider_error",
        message: "Provider failed",
        status: 502
      });
      handlers.onEvent({
        type: "done"
      });
    }
  });

  await api.streamChat(
    {
      messageId: "msg_2",
      input: "hello"
    },
    {
      rejectOnErrorEvent: false,
      onEvent(event) {
        seenEvents.push(event.type);
      }
    }
  );

  assert.deepEqual(seenEvents, ["error", "done"]);
});

test("assistantApi builds list/get routes with query params", async () => {
  const calls = [];
  const api = createApi({
    request: async (url) => {
      calls.push(url);
      return {};
    },
    requestStream: async () => undefined
  });

  await api.listConversations({
    page: 2,
    pageSize: 25,
    status: "completed"
  });
  await api.getConversationMessages("abc/42", {
    page: 1,
    pageSize: 500
  });

  assert.equal(calls[0], "/api/v1/workspace/ai/conversations?page=2&pageSize=25&status=completed");
  assert.equal(calls[1], "/api/v1/workspace/ai/conversations/abc%2F42/messages?page=1&pageSize=500");
});

test("buildStreamEventError normalizes event payload into Error", () => {
  const error = buildStreamEventError({
    code: "forbidden",
    message: "Forbidden",
    status: 403
  });

  assert.equal(error.message, "Forbidden");
  assert.equal(error.code, "forbidden");
  assert.equal(error.status, 403);
  assert.deepEqual(error.event, {
    code: "forbidden",
    message: "Forbidden",
    status: 403
  });
});
