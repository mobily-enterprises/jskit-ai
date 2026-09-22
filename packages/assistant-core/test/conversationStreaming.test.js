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
