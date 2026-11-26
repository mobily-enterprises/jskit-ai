import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./support/conversationExample.js";

const ids = ["planning", "notes", "research", "writing", "review"];
const options = { timeout: 30_000 };

test("voice example streams five chats, stops one independently and reconnects without resending", options, async t => {
  const f = await fixture(t);
  const bootstrap = await f.http.request(`${f.url}/api/bootstrap`, { signal: t.signal });
  assert.deepEqual(bootstrap.example.conversations.map(value => value.id), ids);
  const socket = await f.connect();
  const firstSocketId = socket.id;
  const views = new Map(ids.map(id => [id, f.view(socket, id)]));
  await f.until(() => [...views.values()].every(view => view.initialReads === 1), "five initial subscription snapshots");
  assert.equal(f.socketConnections(), 1);
  for (const [id, view] of views) {
    assert.equal(view.state.id, id);
    assert.deepEqual(view.state.conversationLog, []);
  }

  const inputs = new Map(ids.map(id => [id, { messageId: `question-${id}`, text: `Question for ${id}.` }]));
  const accepted = new Map(await Promise.all(ids.map(async id =>
    [id, await f.api.sendConversationMessage(id, inputs.get(id), { signal: t.signal })])));
  assert.ok([...accepted.values()].every(receipt => receipt.status === "accepted"));
  for (const [id, receipt] of accepted) {
    assert.equal(receipt.messageId, inputs.get(id).messageId);
    assert.equal(typeof receipt.turnId, "string");
    assert.ok(receipt.turnId.length > 0);
  }
  // File-backed turn IDs are allocated inside each conversation, not globally.
  assert.equal(new Set([...accepted].map(([id, receipt]) => JSON.stringify([id, receipt.turnId]))).size, 5);
  await f.until(() => f.requests.length === 5, "five authorized API inferences");
  // Each request ends with the person's message, then the engine's state note.
  const inference = new Map(ids.map(id => [id, f.requests.find(request => request.body.messages.at(-2).content === inputs.get(id).text)]));
  for (const [id, request] of inference) {
    assert.ok(request, `The actual ${id} send reached the configured inference endpoint`);
    assert.equal(request.body.model, "mimo-v2.5-free");
    request.text(`Partial ${id}.`);
  }
  await f.until(() => [...views].every(([id, view]) => view.state.status === "working" &&
    view.state.conversationLog[0]?.user?.messageId === inputs.get(id).messageId &&
    view.state.streaming.messages.some(message => message.text === `Partial ${id}.`)),
    "live text in every conversation subscription");
  for (const [id, view] of views) {
    assert.equal(view.state.status, "working");
    assert.equal(view.state.conversationLog.length, 1);
    assert.equal(view.state.conversationLog[0].turnId, accepted.get(id).turnId);
    assert.equal(view.state.conversationLog[0].user.messageId, inputs.get(id).messageId);
    assert.equal(view.state.conversationLog[0].assistant, null);
    assert.equal(view.state.turns[0].assistant.text, `Partial ${id}.`);
  }

  assert.deepEqual(await f.api.cancelConversation("planning", { signal: t.signal }), { stopped: true });
  await f.until(() => views.get("planning").state.status === "ready", "the cancelled chat's settled snapshot");
  assert.equal(inference.get("planning").signal.aborted, true);
  const stopped = views.get("planning").state.conversationLog[0];
  assert.equal(stopped.metadata.runtime.status, "cancelled");
  assert.equal(stopped.assistant.text, "Partial planning.");
  for (const id of ids.slice(1)) {
    assert.equal(inference.get(id).signal.aborted, false, `Stopping planning preserves ${id}'s inference`);
    assert.equal(views.get(id).state.status, "working");
  }

  socket.disconnect();
  assert.equal(socket.connected, false);
  inference.get("research").text(" While disconnected.");
  const disconnected = await f.api.readConversation("research", { signal: t.signal });
  assert.equal(disconnected.streaming.messages[0].text, "Partial research. While disconnected.");
  assert.equal(views.get("research").state.streaming.messages[0].text, "Partial research.");
  await f.connect(socket);
  await f.until(() => [...views.values()].every(view => view.initialReads === 2) &&
    views.get("research").state.streaming.messages.some(message => message.text === "Partial research. While disconnected."),
  "fresh snapshots and live catch-up after the shared socket reconnects");
  assert.notEqual(socket.id, firstSocketId);
  assert.equal(f.socketConnections(), 2, "Five subscriptions reuse one socket connection on each connect");
  assert.equal(f.requests.length, 5, "Reconnect reads admitted work without another inference");
  for (const id of ids.slice(1)) assert.equal(inference.get(id).signal.aborted, false);

  for (const id of ids.slice(1)) {
    inference.get(id).text(" Complete.");
    inference.get(id).finish();
  }
  await f.until(() => ids.slice(1).every(id => views.get(id).state.status === "ready" &&
    views.get(id).state.conversationLog[0].metadata.runtime.status === "complete"), "four saved completed answers");
  for (const id of ids.slice(1)) {
    const view = views.get(id);
    const answer = `Partial ${id}.${id === "research" ? " While disconnected." : ""} Complete.`;
    assert.equal(view.state.conversationLog.length, 1);
    assert.equal(view.state.conversationLog[0].turnId, accepted.get(id).turnId);
    assert.equal(view.state.conversationLog[0].assistant.text, answer);
    assert.equal(view.state.turns[0].assistant.text, answer);
    assert.deepEqual(view.state.streaming.messages, []);
    assert.ok(view.events.some(event => event.type === "message" && event.status === "inProgress"));
  }
  for (const [id, view] of views) {
    assert.deepEqual(view.errors, []);
    assert.ok(view.events.every(event => event.conversationId === id));
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const receipt = await f.api.inspectConversationDelivery("research", inputs.get("research").messageId, { signal: t.signal });
    assert.equal(receipt.status, "accepted");
    assert.equal(receipt.turnId, accepted.get("research").turnId);
  }
  assert.deepEqual(await f.api.inspectConversationDelivery("notes", "never-sent", { signal: t.signal }),
    { status: "unknown", messageId: "never-sent" });
  assert.equal(f.requests.length, 5, "Accepted and unknown delivery inspection do not resend anything");
  const records = await f.stored();
  assert.deepEqual(records.map(record => record.scope).sort(), [...ids].sort());
  assert.ok(records.every(record => record.turns.length === 1));
  for (const record of records) {
    const [turnId, turn] = record.turns[0];
    assert.equal(turnId, accepted.get(record.scope).turnId);
    assert.equal(turn.messages.find(message => message.role === "user").messageId, inputs.get(record.scope).messageId);
  }
  assert.equal(socket.connected, true);
  assert.equal(f.socketConnections(), 2);
});

test("voice example runs a direct file-backed headless task while denying browser access to it", options, async t => {
  const f = await fixture(t);
  const text = "Perform the bounded server task.";
  const answer = f.runHeadless(text);
  // Keep an early provider failure observed while waiting for its controlled stream.
  answer.catch(() => {});
  await f.until(() => f.requests.length === 1, "the actual runHeadless inference");
  assert.equal(f.requests[0].body.messages[0].content, "You are the assistant for Headless task. Answer briefly in plain language.", "The system prompt");
  assert.equal(f.requests[0].body.messages.at(-2).content, text);
  assert.match(f.requests[0].body.messages.at(-1).content, /^Current state, from the system\. /u, "The engine's state note follows the conversation");
  f.requests[0].text("The headless task is complete.");
  f.requests[0].finish();
  assert.equal(await answer, "The headless task is complete.");

  const socket = await f.connect();
  const denied = f.view(socket, "headless");
  const planning = f.view(socket, "planning");
  await f.until(() => denied.errors.length === 1 && planning.initialReads === 1,
    "the browser headless denial and ordinary conversation subscription");
  assert.equal(denied.errors[0].statusCode, 403);
  assert.deepEqual(denied.states, []);
  assert.deepEqual(planning.state.conversationLog, []);
  assert.deepEqual(planning.errors, []);
  await assert.rejects(f.api.readConversation("headless", { signal: t.signal }), { status: 403 });
  await assert.rejects(f.api.sendConversationMessage("headless", { messageId: "browser-attempt", text: "Never dispatch." },
    { signal: t.signal }), { status: 403 });
  await assert.rejects(f.api.cancelConversation("headless", { signal: t.signal }), { status: 403 });
  await assert.rejects(f.api.inspectConversationDelivery("headless", "browser-attempt", { signal: t.signal }), { status: 403 });
  assert.equal(f.requests.length, 1, "Browser denial cannot invoke or replay headless inference");
  const records = await f.stored();
  assert.deepEqual(records.map(record => record.scope).sort(), [...ids, "headless"].sort());
  assert.equal(records.find(record => record.scope === "headless").turns.length, 1);
  assert.ok(records.filter(record => record.scope !== "headless").every(record => record.turns.length === 0));
});
