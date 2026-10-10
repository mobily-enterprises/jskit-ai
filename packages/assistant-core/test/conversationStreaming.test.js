import assert from "node:assert/strict";
import test from "node:test";
import { createConversationStreams } from "../src/server/conversation/streams.js";
import { classifyCodexAppServerEvent } from "../src/server/conversation/codexEvents.js";
import { createOpenCodeServerClient, openCodeAssistantMessageText } from "../src/server/conversation/openCodeClient.js";
import { mergeConversationStream } from "../src/shared/conversation/streaming.js";

test("Codex chunks retain whitespace and item identity; completed items reject late chunks", () => {
  const streams = createConversationStreams();
  const params = { threadId: "thread", turnId: "turn", itemId: "answer" };
  const started = classifyCodexAppServerEvent({ method: "item/started", params: {
    ...params, item: { id: "answer", type: "agentMessage", phase: "final_answer" }
  } });
  assert.equal(started.kind, "assistant_started");
  streams.update("session", { ...started, messageId: started.itemId });
  for (const delta of ["Hello", " ", "world", "\n\n", "```js\n  x()\n``` "]) {
    const event = classifyCodexAppServerEvent({ method: "item/agentMessage/delta", params: { ...params, delta } });
    assert.equal(event.kind, "assistant_delta");
    assert.equal(event.delta, delta);
    streams.update("session", { ...event, messageId: event.itemId });
  }
  const snapshot = streams.read("session");
  assert.equal(snapshot.messages[0].text, "Hello world\n\n```js\n  x()\n``` ");
  assert.equal(snapshot.messages[0].status, "inProgress");
  snapshot.messages[0].text = "Mutation must not change the stream";
  assert.match(streams.read("session").messages[0].text, /^Hello world/);
  const completed = streams.complete("session", "answer");
  assert.deepEqual(completed.messages, []);
  assert.equal(streams.update("session", { ...params, messageId: "answer", delta: "late" }), null);
  assert.deepEqual(streams.read("other-session").messages, []);
});

test("OpenCode text snapshots replace partial text and unchanged snapshots emit nothing", () => {
  const streams = createConversationStreams();
  const message = { turnId: "turn", messageId: "answer" };
  const text = openCodeAssistantMessageText({ content: [{ type: "reasoning", text: "private" }, { type: "text", text: "Hello " }] });
  assert.equal(text, "Hello ");
  streams.update("one", { ...message, text });
  assert.equal(streams.update("one", { ...message, text }), null);
  const next = streams.update("one", { ...message, text: "Hello world" });
  assert.equal(next.messages[0].text, "Hello world");
  assert.deepEqual(streams.clear("one").messages, []);
  streams.update("one", { ...message, turnId: "next", text: "New answer" });
  assert.equal(streams.read("one").messages.length, 1);
});

test("commentary keeps its role and saved answers replace live text without mutating history", () => {
  const streams = createConversationStreams();
  const started = classifyCodexAppServerEvent({ method: "item/started", params: {
    threadId: "thread", turnId: "turn", item: { id: "comment", type: "agentMessage", phase: "commentary" }
  } });
  streams.update("one", { ...started, messageId: started.itemId });
  streams.update("one", { turnId: "turn", messageId: "comment", delta: "Checking" });
  assert.equal(streams.read("one").messages[0].role, "commentary");
  streams.complete("one", "comment");
  streams.update("one", { turnId: "turn", messageId: "answer", text: "Partial" });
  const user = { role: "user", messageId: "user", text: "Question" };
  const turns = [{ turnId: "000001", user, messages: [user] }];
  const live = mergeConversationStream(turns, streams.read("one"));
  assert.equal(live[0].turnId, "000001");
  assert.equal(live[0].assistant.text, "Partial");
  assert.equal(live[0].pending, true);
  assert.equal(turns[0].messages.length, 1);
  const final = { role: "assistant", messageId: "answer", text: "Final answer" };
  const saved = [{ ...turns[0], assistant: final, messages: [user, final] }];
  assert.equal(mergeConversationStream(saved, streams.read("one")), saved);
  const withoutMessages = [{ turnId: "000001", user, assistant: final }];
  assert.equal(mergeConversationStream(withoutMessages, streams.read("one")), withoutMessages);
  assert.equal(mergeConversationStream([{ turnId: "000001", user }], streams.read("one"))[0].messages[0], user);
});


test("OpenCode deletes an exact message without reverting project files", async () => {
  const calls = [];
  const client = createOpenCodeServerClient({ baseUrl: "http://127.0.0.1:9999", directory: "/test/project", password: "test-password",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), ...options });
      return new Response("true", { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(await client.deleteMessage("ses_test", "msg_test"), true);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(new URL(calls[0].url).pathname, "/session/ses_test/message/msg_test");
  assert.ok(calls[0].headers.Authorization || calls[0].headers.authorization);
  await assert.rejects(client.deleteMessage("ses_test", ""), /requires a message id/);
  assert.equal(calls.length, 1);
});

test("runtime streams retain authored identity and origin across application wakes and late output", () => {
  const streams = createConversationStreams();
  const oldUser = { messageId: "older-user", role: "user", text: "Earlier question" };
  const wake = { messageId: "wake", role: "system", text: "Application update" };
  const turns = [
    { turnId: "older", user: oldUser, messages: [oldUser] },
    { turnId: "update", system: wake, messages: [wake], metadata: { runtime: { origin: "application" } } }
  ];
  streams.update("chat", { turnId: "update", origin: "application", messageId: "answer", text: "Update" });
  streams.update("chat", { turnId: "update", messageId: "answer", delta: " received" });
  const snapshot = streams.read("chat");
  assert.equal(snapshot.messages[0].turnId, "update");
  assert.equal(snapshot.messages[0].origin, "application");
  const live = mergeConversationStream(turns, snapshot);
  assert.equal(live.length, 2);
  assert.equal(live[1].turnId, "update");
  assert.equal(live[1].assistant.origin, "application");
  assert.equal(live[1].assistant.text, "Update received");
  assert.equal(turns[1].messages.length, 1, "Projection must not mutate saved history");
  const hiddenWake = mergeConversationStream([], snapshot);
  assert.equal(hiddenWake[0].turnId, "update", "Hiding a system prompt must not change the reply identity");
  const late = mergeConversationStream(turns, { messages: [
    { messageId: "late-answer", turnId: "older", origin: "user", role: "assistant", text: "Earlier reply" }
  ] });
  assert.equal(late.length, 2);
  assert.equal(late[0].assistant.text, "Earlier reply");
  assert.equal(late[1].assistant, undefined, "Late output belongs to its authored turn, not the latest wake");
});

test("native streams retain proven origin without exposing or changing their native grouping", () => {
  const streams = createConversationStreams();
  const nativeIdentity = { threadId: "native-thread", turnId: "native-turn" };
  const input = { nativeIdentity, turnId: "native-thread:native-turn", origin: "application", messageId: "native-reply" };
  streams.update("chat", { ...input, text: "First" });
  streams.update("chat", { ...input, delta: " chunk" });
  const snapshot = streams.read("chat");
  assert.equal(snapshot.messages[0].text, "First chunk");
  assert.equal(snapshot.messages[0].origin, "application");
  assert.equal(Object.hasOwn(snapshot.messages[0], "turnId"), false);
  assert.equal(JSON.stringify(snapshot).includes("nativeIdentity"), false);
  const projected = mergeConversationStream([], snapshot);
  assert.equal(projected[0].assistant.origin, "application");
  assert.equal(projected[0].turnId, "stream:native-reply");
  streams.complete("chat", input.messageId);
  assert.equal(streams.update("chat", { ...input, delta: "late" }), null);
  const next = streams.update("chat", { ...input,
    nativeIdentity: { ...nativeIdentity, turnId: "next-turn" }, turnId: "native-thread:next-turn", text: "Next reply" });
  assert.equal(next.messages[0].text, "Next reply");
});

test("output identity survives stream revisions and saved projection without changing native message IDs", () => {
  const streams = createConversationStreams();
  const input = { turnId: "authored", messageId: "native-live", outputId: "exact-output", origin: "user" };
  streams.update("chat", { ...input, text: "Partial" });
  const snapshot = streams.update("chat", { turnId: input.turnId, messageId: input.messageId, delta: " answer" });
  assert.equal(snapshot.messages[0].outputId, "exact-output");
  assert.equal(snapshot.messages[0].messageId, "native-live");
  const user = { role: "user", messageId: "request", text: "Question" };
  const turns = [{ turnId: "authored", user, messages: [user] }];
  assert.equal(mergeConversationStream(turns, snapshot)[0].assistant.outputId, "exact-output");
  const saved = { role: "assistant", messageId: "native-saved", outputId: "exact-output", text: "Partial answer" };
  streams.complete("chat", "native-live");
  const final = [{ ...turns[0], assistant: saved, messages: [user, saved] }];
  assert.equal(mergeConversationStream(final, streams.read("chat")), final);
  assert.equal(final[0].assistant.messageId, "native-saved");
  assert.equal(final[0].assistant.outputId, snapshot.messages[0].outputId);
});


test("native completed carriers retain exact final text once without exposing private custody in live reads", () => {
  const streams = createConversationStreams();
  const input = { nativeIdentity: { threadId: "thread", turnId: "native-turn" }, turnId: "thread:native-turn",
    messageId: "native-item", outputId: "exact-output", role: "commentary", origin: "user",
    authorship: { messageId: "authored-message", turnId: "000001", origin: "user" } };
  streams.update("chat", { ...input, delta: "Partial words" });
  const live = streams.read("chat");
  assert.equal(Object.hasOwn(live.messages[0], "turnId"), false);
  assert.equal(JSON.stringify(live).includes("authored-message"), false);
  assert.equal(JSON.stringify(live).includes("nativeIdentity"), false);
  const final = "Corrected completed sentence.\nExact ending.";
  const completed = streams.complete("chat", input.messageId, { text: final });
  assert.deepEqual(completed.messages, []);
  assert.deepEqual(completed.completedMessages.map(message => ({ turnId: message.turnId, outputId: message.outputId,
    messageId: message.messageId, origin: message.origin, role: message.role, text: message.text, status: message.status })),
  [{ turnId: "000001", outputId: "exact-output", messageId: "native-item", origin: "user", role: "commentary",
    text: final, status: "complete" }]);
  completed.completedMessages[0].text = "Changed return value";
  assert.equal(streams.read("chat").completedMessages, undefined);
  assert.equal(streams.complete("chat", input.messageId, { text: final }).completedMessages, undefined);
  assert.equal(streams.update("chat", { ...input, delta: "late" }), null);
  assert.deepEqual(streams.read("chat").messages, []);
  assert.deepEqual(input.authorship, { messageId: "authored-message", turnId: "000001", origin: "user" });
  streams.update("chat", { ...input, messageId: "phase-less-item", role: "assistant", text: "Initially unclassified" });
  assert.equal(streams.complete("chat", "phase-less-item", { text: "Completed progress", role: "commentary" })
    .completedMessages[0].role, "commentary", "The completed native classification owns the role, not an initial phase-less delta");
});

test("unproven native origin and duplicate cleanup cannot produce completed authored carriers", () => {
  const streams = createConversationStreams();
  const input = { nativeIdentity: { threadId: "thread", turnId: "turn" }, turnId: "thread:turn",
    messageId: "unproven", role: "commentary", origin: "application" };
  streams.update("chat", { ...input, text: "Unproven sentence" });
  assert.equal(streams.complete("chat", input.messageId, { text: "Unproven sentence" }).completedMessages, undefined);
  streams.update("chat", { ...input, messageId: "duplicate", text: "Same sentence",
    authorship: { turnId: "000001", messageId: "request", origin: "application" } });
  assert.equal(streams.complete("chat", "duplicate").completedMessages, undefined,
    "Fingerprint cleanup is not a completed-text publication");
  assert.equal(streams.complete("chat", "duplicate", { text: "Same sentence" }).completedMessages, undefined);
  assert.equal(streams.complete("other", "missing", { text: "No item" }).completedMessages, undefined);
  streams.update("chat", { ...input, messageId: "initially-unproven", text: "Earlier unowned output" });
  streams.update("chat", { ...input, messageId: "initially-unproven", text: "Later words",
    authorship: { turnId: "000002", messageId: "successor-request", origin: "application" } });
  assert.equal(streams.complete("chat", "initially-unproven", { text: "Late completed output" }).completedMessages, undefined,
    "A later current request cannot adopt an item that had no captured authored custody");
});


test("completed-envelope stream scalar changes participate in dedup and require captured application authorship", () => {
  const streams = createConversationStreams();
  const input = { turnId: "native:turn", nativeIdentity: { threadId: "native", turnId: "turn" },
    messageId: "item", origin: "application", text: "Exact partial",
    authorship: { messageId: "request", origin: "application" } };
  const first = streams.update("chat", input);
  assert.equal(first.messages[0].completedEnvelope, undefined);
  const marked = streams.update("chat", { ...input, authorship: { ...input.authorship, completedEnvelope: true } });
  assert.equal(marked.messages[0].completedEnvelope, true);
  assert.ok(marked.revision > first.revision, "Equal text does not hide an actual trusted scalar change");
  assert.equal(streams.update("chat", { ...input, authorship: { ...input.authorship, completedEnvelope: true } }), null);
  streams.update("chat", { ...input, messageId: "unowned", authorship: undefined,
    completedEnvelope: true, data: { completedEnvelope: true } });
  assert.equal(streams.read("chat").messages.find(message => message.messageId === "unowned").completedEnvelope, undefined);
  streams.update("chat", { ...input, messageId: "ordinary", origin: "user",
    authorship: { messageId: "user-request", turnId: "000002", origin: "user", completedEnvelope: true } });
  assert.equal(streams.read("chat").messages.find(message => message.messageId === "ordinary").completedEnvelope, undefined);
});

test("completed-envelope completion keeps its captured scalar while resolving only the same authored pending receipt", () => {
  const streams = createConversationStreams();
  const input = { turnId: "native:turn", nativeIdentity: { threadId: "native", turnId: "turn" }, messageId: "item",
    origin: "application", text: "Partial", authorship: { messageId: "request", origin: "application", completedEnvelope: true } };
  streams.update("chat", input);
  const completed = streams.complete("chat", "item", { text: "Exact final", role: "assistant",
    authorship: { messageId: "request", turnId: "000001", origin: "application" } });
  assert.equal(completed.completedMessages[0].completedEnvelope, true);
  assert.equal(completed.completedMessages[0].turnId, "000001");
  assert.equal(completed.completedMessages[0].text, "Exact final");
  assert.equal(streams.complete("chat", "item", { text: "Repeat" }).completedMessages, undefined);
  streams.update("chat", { ...input, messageId: "old-pending" });
  assert.equal(streams.complete("chat", "old-pending", { text: "Wrong association", authorship: {
    messageId: "successor", turnId: "000002", origin: "application", completedEnvelope: true
  } }).completedMessages, undefined);
});
