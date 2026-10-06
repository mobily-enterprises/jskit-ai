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
    cursor: "next-page",
    limit: 5,
    status: "completed"
  });
  await api.getConversationMessages(99, {
    page: 2,
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
  const conversationsUrl = new URL(observed.list?.url, "https://assistant.test");
  assert.equal(conversationsUrl.searchParams.get("page[cursor]"), "next-page");
  assert.equal(conversationsUrl.searchParams.get("page[limit]"), "5");
  assert.equal(conversationsUrl.searchParams.get("filter[status]"), "completed");
  assert.equal(conversationsUrl.searchParams.has("cursor"), false);
  assert.equal(conversationsUrl.searchParams.has("limit"), false);
  assert.equal(conversationsUrl.searchParams.has("status"), false);
  const messagesUrl = new URL(observed.messages?.url, "https://assistant.test");
  assert.equal(messagesUrl.searchParams.get("filter[page]"), "2");
  assert.equal(messagesUrl.searchParams.get("filter[pageSize]"), "5");
  assert.equal(messagesUrl.searchParams.has("page"), false);
  assert.equal(messagesUrl.searchParams.has("pageSize"), false);
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

test("canonical operations reuse the request owner, surface header and encoded conversation identity", async () => {
  const calls = [];
  const receipt = { status: "accepted", messageId: "question", turnId: "turn" };
  const controller = new AbortController();
  const api = createAssistantApi({
    resolveBasePath: () => "/api/w/one/assistant/admin",
    resolveSurfaceId: () => "AdMiN",
    async request(url, options) { calls.push({ url, options }); return receipt; }
  });
  const id = "chat:one/two";
  assert.equal(await api.readConversation(id, { signal: controller.signal }), receipt);
  assert.equal(await api.sendConversationMessage(id, {
    messageId: "question", text: "", attachmentIds: ["file-one"], steer: false,
    actor: { id: "injected" }, context: { forged: true }, host: { nativeTools: true }, engine: "codex"
  }), receipt);
  assert.equal(await api.cancelConversation(id), receipt);
  assert.equal(await api.inspectConversationDelivery(id, "question"), receipt);
  const base = "/api/w/one/assistant/admin/conversations/chat%3Aone%2Ftwo";
  assert.deepEqual(calls.map(call => call.url), [base, `${base}/messages`, `${base}/cancel`, `${base}/deliveries/question/inspect`]);
  assert.deepEqual(calls.map(call => call.options.method), ["GET", "POST", "POST", "POST"]);
  assert.ok(calls.every(call => call.options.headers["x-jskit-surface"] === "admin"));
  assert.equal(calls[0].options.signal, controller.signal);
  assert.deepEqual(calls[1].options.body, { messageId: "question", text: "", attachmentIds: ["file-one"], steer: false });
  assert.equal(Object.hasOwn(calls[2].options, "body"), false);
  assert.equal(Object.hasOwn(calls[3].options, "body"), false, "Inspection supplies only the stable path identity");

  await api.sendConversationMessage(id, { messageId: "plain", text: "Exact\n  authored text" });
  assert.deepEqual(calls[4].options.body, { messageId: "plain", text: "Exact\n  authored text" });
  const goal = { action: "set", expectedSegmentId: "current", expectedGoalId: null,
    messageId: "goal-one", objective: "Finish this", tokenBudget: 1000, attachmentIds: ["file-one"] };
  await api.readConversationGoal(id);
  await api.updateConversationGoal(id, { ...goal, actor: { id: "injected" }, engine: "codex",
    attachments: [{ path: "/private/secret" }], host: { nativeTools: true } }, { signal: controller.signal });
  assert.deepEqual(calls.slice(5).map(call => [call.url, call.options.method]), [[`${base}/goal`, "GET"], [`${base}/goal`, "POST"]]);
  assert.deepEqual(calls[6].options.body, goal);
  assert.equal(calls[6].options.signal, controller.signal);
  await assert.rejects(api.streamChat({ input: "Legacy stream" }), /streamChat requires requestStream/);

  const data = { clientId: "browser-one", focus: { sessionId: "authored-target" } };
  await api.sendConversationMessage(id, { messageId: "with-data", text: "Use this capture", data,
    actor: { id: "injected" }, context: { forged: true }, host: { nativeTools: true } });
  assert.deepEqual(calls[7].options.body, { messageId: "with-data", text: "Use this capture", data });
  assert.equal(calls[7].url, `${base}/messages`);
  assert.equal(calls[7].options.headers["x-jskit-surface"], "admin");

  const configuration = { effort: "high" };
  const selection = { modelChoice: "catalogue-choice" };
  await api.configureConversation(id, configuration, { signal: controller.signal });
  await api.selectConversation(id, selection, { signal: controller.signal });
  assert.deepEqual(calls.slice(8).map(call => [call.url, call.options.method, call.options.body]), [
    [`${base}/configuration`, "PATCH", { configuration }],
    [`${base}/selection`, "POST", { selection }]
  ]);
  assert.ok(calls.slice(8).every(call => call.options.signal === controller.signal &&
    call.options.headers["x-jskit-surface"] === "admin"));

  await api.readConversation(id, { beforeTurnId: "turn:one/two & three", limit: 20, signal: controller.signal,
    actor: { id: "injected" }, context: { forged: true }, host: { nativeTools: true } });
  assert.equal(calls[10].url, `${base}?beforeTurnId=turn%3Aone%2Ftwo+%26+three&limit=20`);
  assert.equal(calls[10].options.method, "GET");
  assert.equal(calls[10].options.signal, controller.signal);
  assert.deepEqual(calls[10].options.headers, { "x-jskit-surface": "admin" });
  assert.equal(Object.hasOwn(calls[10].options, "body"), false);
  await api.readConversation(id, { beforeTurnId: "", limit: 0 });
  assert.equal(calls[11].url, `${base}?limit=0`, "Explicit zero retains the original unbounded page query");
});

test("declared replacement client retains the surface, exact choice and abort signal", async () => {
  const calls = [];
  const api = createAssistantApi({
    request: async (url, options) => { calls.push({ url, options }); return { ok: true }; },
    resolveBasePath: () => "/api/assistant/app",
    resolveSurfaceId: () => "app"
  });
  const controller = new AbortController();
  const replacement = { operationId: "renew-one", expectedSegmentId: "observed-segment", choice: "renew" };
  await api.replaceConversation("chat:one/two", replacement, { signal: controller.signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/assistant/app/conversations/chat%3Aone%2Ftwo/replacement");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.body, { replacement });
  assert.deepEqual(calls[0].options.headers, { "x-jskit-surface": "app" });
  assert.equal(calls[0].options.signal, controller.signal);
});
