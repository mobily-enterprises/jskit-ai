import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantWorkspaceApi } from "../src/client/lib/assistantApi.js";

test("assistant workspace api forwards normalized surface header on requests", async () => {
  const observed = {
    stream: null,
    list: null,
    messages: null
  };

  const api = createAssistantWorkspaceApi({
    resolveSurfaceId: () => "AdMiN",
    async request(url, options = {}) {
      if (url.includes("/messages")) {
        observed.messages = { url, options };
      } else {
        observed.list = { url, options };
      }
      return {};
    },
    async requestStream(url, options = {}) {
      observed.stream = { url, options };
      return null;
    }
  });

  await api.streamChat("acme", {
    messageId: "msg_1",
    input: "Hello"
  });
  await api.listConversations("acme", {
    limit: 5
  });
  await api.getConversationMessages("acme", 99, {
    page: 1,
    pageSize: 5
  });

  assert.equal(observed.stream?.options?.headers?.["x-jskit-surface"], "admin");
  assert.equal(observed.list?.options?.headers?.["x-jskit-surface"], "admin");
  assert.equal(observed.messages?.options?.headers?.["x-jskit-surface"], "admin");
});

test("assistant workspace api omits surface header when surface id is empty", async () => {
  const observed = [];
  const api = createAssistantWorkspaceApi({
    resolveSurfaceId: () => "",
    async request(url, options = {}) {
      observed.push({
        url,
        options
      });
      return {};
    },
    async requestStream(_url, _options = {}) {
      return null;
    }
  });

  await api.listConversations("acme");
  assert.equal(observed.length, 1);
  assert.equal(Object.hasOwn(observed[0].options || {}, "headers"), false);
});
