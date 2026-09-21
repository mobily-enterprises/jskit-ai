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
  assert.equal(delivery.state.messages[0].status, "accepted");
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

test("queued messages appear immediately and deliver in order with captured payloads", async () => {
  const requests = [Promise.withResolvers(), Promise.withResolvers(), Promise.withResolvers()];
  const sent = [];
  const delivery = createAssistantMessageDelivery({ deliver: payload => {
    sent.push(payload);
    return requests[sent.length - 1].promise;
  } });
  const first = delivery.send({ message: "First" }, { messageId: "one" });
  const payload = { message: "Second", configuration: { model: "original" } };
  const second = delivery.send(payload, { messageId: "two", queue: true });
  const third = delivery.send({ message: "Third" }, { messageId: "three", queue: true });
  payload.configuration.model = "changed";
  assert.deepEqual(delivery.turns().map(turn => [turn.user.text, turn.optimistic.status]),
    [["First", "pending"], ["Second", "pending"], ["Third", "pending"]]);
  assert.equal(await delivery.send({ message: "Duplicate" }, { messageId: "two", queue: true }), false);
  assert.deepEqual(sent.map(message => message.messageId), ["one"]);
  requests[0].resolve({ ok: true });
  await first;
  assert.equal(delivery.state.sending, true);
  assert.equal(delivery.find("one").status, "accepted");
  assert.deepEqual(sent.map(message => message.messageId), ["one", "two"]);
  assert.equal(sent[1].configuration.model, "original");
  requests[1].resolve({ ok: true });
  await second;
  assert.deepEqual(sent.map(message => message.messageId), ["one", "two", "three"]);
  requests[2].resolve({ ok: true });
  await third;
  assert.equal(delivery.state.sending, false);
});

test("a failed message retains its retry identity while later guidance is pending", async () => {
  const firstRequest = Promise.withResolvers();
  const secondRequest = Promise.withResolvers();
  const sent = [];
  const delivery = createAssistantMessageDelivery({ deliver: payload => {
    sent.push(payload);
    return [firstRequest.promise, secondRequest.promise, { ok: true }][sent.length - 1];
  } });
  const first = delivery.send({ message: "First", configuration: { model: "one" } }, { messageId: "one" });
  const second = delivery.send({ message: "Second" }, { messageId: "two", queue: true });
  const rejected = assert.rejects(first, /Offline/);
  firstRequest.reject(new Error("Offline"));
  await rejected;
  assert.equal(delivery.find("one").status, "failed");
  assert.equal(delivery.find("one").error, "Offline");
  const retry = delivery.resend("one", { queue: true });
  assert.equal(delivery.find("one").status, "pending");
  assert.equal(sent.length, 2);
  secondRequest.resolve({ ok: true });
  await second;
  await retry;
  assert.deepEqual(sent[2], sent[0]);
  assert.equal(delivery.state.sending, false);
});

test("reset discards queued delivery without waiting for the old transport", async () => {
  const request = Promise.withResolvers();
  const sent = [];
  const delivery = createAssistantMessageDelivery({ deliver: payload => {
    sent.push(payload.message);
    return request.promise;
  } });
  const first = delivery.send({ message: "Old" });
  const queued = delivery.send({ message: "Queued" }, { queue: true });
  delivery.reset();
  assert.equal(await queued, false);
  assert.deepEqual(sent, ["Old"]);
  const next = delivery.send({ message: "New" });
  assert.deepEqual(sent, ["Old", "New"]);
  assert.equal(delivery.state.sending, true);
  request.resolve({ ok: true });
  assert.equal(await first, false);
  assert.deepEqual(await next, { ok: true });
  assert.equal(delivery.state.sending, false);
});
