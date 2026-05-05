import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantApi } from "../src/client/lib/assistantApi.js";
import {
  ASSISTANT_CONVERSATIONS_TRANSPORT,
  ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT,
  ASSISTANT_SETTINGS_TRANSPORT,
  ASSISTANT_SETTINGS_UPDATE_TRANSPORT
} from "../src/shared/index.js";

test("assistant api forwards normalized surface header on requests", async () => {
  const observed = {
    stream: null,
    list: null,
    messages: null,
    settingsRead: null,
    settingsUpdate: null
  };

  const api = createAssistantApi({
    resolveBasePath: () => "/api/assistant",
    resolveSurfaceId: () => "AdMiN",
    async request(url, options = {}) {
      if (url.endsWith("/settings") && options?.method === "PATCH") {
        observed.settingsUpdate = { url, options };
      } else if (url.endsWith("/settings")) {
        observed.settingsRead = { url, options };
      } else if (url.includes("/messages")) {
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

  await api.streamChat({
    messageId: "msg_1",
    input: "Hello"
  });
  await api.listConversations({
    limit: 5
  });
  await api.getConversationMessages(99, {
    page: 1,
    pageSize: 5
  });
  await api.getSettings();
  await api.updateSettings({
    systemPrompt: "Be concise."
  });

  assert.equal(observed.stream?.options?.headers?.["x-jskit-surface"], "admin");
  assert.equal(observed.list?.options?.headers?.["x-jskit-surface"], "admin");
  assert.equal(observed.messages?.options?.headers?.["x-jskit-surface"], "admin");
  assert.equal(observed.settingsRead?.options?.headers?.["x-jskit-surface"], "admin");
  assert.equal(observed.settingsUpdate?.options?.headers?.["x-jskit-surface"], "admin");
  assert.deepEqual(observed.list?.options?.transport, ASSISTANT_CONVERSATIONS_TRANSPORT);
  assert.deepEqual(observed.messages?.options?.transport, ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT);
  assert.deepEqual(observed.settingsRead?.options?.transport, ASSISTANT_SETTINGS_TRANSPORT);
  assert.deepEqual(observed.settingsUpdate?.options?.transport, ASSISTANT_SETTINGS_UPDATE_TRANSPORT);
});

test("assistant api omits surface header when surface id is empty", async () => {
  const observed = [];
  const api = createAssistantApi({
    resolveBasePath: () => "/api/assistant",
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

  await api.listConversations();
  assert.equal(observed.length, 1);
  assert.equal(Object.hasOwn(observed[0].options || {}, "headers"), false);
});
