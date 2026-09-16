import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantMessageDelivery } from "../src/client/conversation/messageDelivery.js";

test("sending immediately renders the message and reconciles only its authoritative receipt", async () => {
  const request = Promise.withResolvers();
  const delivery = createAssistantMessageDelivery({ deliver: () => request.promise });
  const sending = delivery.send({ message: "Hello", displayAttachments: [{ attachmentId: "file" }] });
  const [turn] = delivery.turns();
  assert.equal(delivery.state.sending, true);
  assert.equal(turn.user.text, "Hello");
  assert.equal(turn.user.attachments[0].attachmentId, "file");
  assert.equal(await delivery.send({ message: "Duplicate click" }), false);
  const other = { user: { messageId: "different", text: "Hello", at: turn.user.at } };
  delivery.reconcile([other]);
  assert.equal(delivery.state.messages.length, 1);
  const receipt = { user: { ...turn.user } };
  delivery.reconcile([other, receipt]);
  assert.equal(delivery.state.messages.length, 0);
  assert.deepEqual(delivery.turns([other, receipt]), [other, receipt]);
  request.resolve({ ok: true });
  await sending;
  assert.equal(delivery.state.sending, false);
});

test("failed delivery retains the original payload and identity for an explicit retry", async () => {
  const sent = [];
  const delivery = createAssistantMessageDelivery({ deliver: async payload => {
    sent.push(payload);
    if (sent.length === 1) throw new Error("Offline");
    return { ok: true };
  } });
  const payload = { message: "Question", configuration: { model: "one" } };
  await assert.rejects(delivery.send(payload), /Offline/);
  payload.configuration.model = "two";
  const [message] = delivery.state.messages;
  assert.equal(message.status, "failed");
  assert.equal(message.error, "Offline");
  assert.equal(delivery.state.sending, false);
  assert.deepEqual(await delivery.resend(message.id), { ok: true });
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[1].configuration.model, "one");
  assert.equal(delivery.state.messages.length, 1);
  assert.equal(delivery.state.messages[0].status, "pending");
});

test("cancel and edit affect failed messages and preserve a newer draft", async () => {
  const delivery = createAssistantMessageDelivery({ deliver: async () => ({ ok: false, error: "Unavailable" }) });
  await delivery.send({ message: "First" }, { messageId: "one" });
  assert.equal(delivery.state.messages[0].error, "Unavailable");
  assert.equal(delivery.edit("one", "New draft"), "First\n\nNew draft");
  assert.equal(delivery.edit("one", "New draft"), null);
  await delivery.send({ message: "Second" }, { messageId: "two" });
  assert.equal(delivery.cancel("two"), true);
  assert.deepEqual(delivery.state.messages, []);
});

test("retiring a conversation isolates late responses from the next conversation", async () => {
  const oldRequest = Promise.withResolvers();
  const newRequest = Promise.withResolvers();
  const delivery = createAssistantMessageDelivery();
  const oldSend = delivery.send({ message: "Old" }, { deliver: () => oldRequest.promise });
  delivery.reset();
  const newSend = delivery.send({ message: "New" }, { deliver: () => newRequest.promise });
  oldRequest.reject(new Error("Late failure"));
  assert.equal(await oldSend, false);
  assert.equal(delivery.state.sending, true);
  assert.deepEqual(delivery.state.messages.map(message => message.text), ["New"]);
  newRequest.resolve({ ok: true });
  await newSend;
  assert.equal(delivery.state.sending, false);
});
