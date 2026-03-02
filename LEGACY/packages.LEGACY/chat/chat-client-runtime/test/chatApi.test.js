import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/lib/chatApi.js";

test("chatApi listInbox appends query params", async () => {
  const requestCalls = [];
  const api = createApi({
    request: async (url, options) => {
      requestCalls.push([url, options]);
      return {};
    }
  });

  await api.listInbox({
    cursor: "abc",
    limit: 25
  });

  assert.equal(requestCalls[0][0], "/api/v1/chat/inbox?cursor=abc&limit=25");
  assert.equal(requestCalls[0][1], undefined);
});

test("chatApi sendThreadMessage encodes thread id and sends payload", async () => {
  const requestCalls = [];
  const api = createApi({
    request: async (url, options) => {
      requestCalls.push([url, options]);
      return {};
    }
  });

  await api.sendThreadMessage("thread/42", {
    text: "hello"
  });

  assert.equal(requestCalls[0][0], "/api/v1/chat/threads/thread%2F42/messages");
  assert.deepEqual(requestCalls[0][1], {
    method: "POST",
    body: {
      text: "hello"
    }
  });
});

test("chatApi uploadThreadAttachment sends FormData payload", async () => {
  const requestCalls = [];
  const api = createApi({
    request: async (url, options) => {
      requestCalls.push([url, options]);
      return {};
    }
  });
  const formData = new FormData();
  formData.append("file", "demo");

  await api.uploadThreadAttachment(12, formData);

  assert.equal(requestCalls[0][0], "/api/v1/chat/threads/12/attachments/upload");
  assert.equal(requestCalls[0][1].method, "POST");
  assert.equal(requestCalls[0][1].body, formData);
});
