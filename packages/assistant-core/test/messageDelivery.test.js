import assert from "node:assert/strict";
import test from "node:test";
import { nextTick, ref } from "vue";
import { createAssistantMessageDelivery, unmatchedOptimisticMessages } from "../src/client/conversation/messageDelivery.js";
import { normalizeConversationTurn } from "../src/shared/conversation/patches.js";

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

test("a canonical receipt settles the retained send before its HTTP response", async () => {
  const request = Promise.withResolvers();
  const receipts = ref([]);
  const delivery = createAssistantMessageDelivery();
  const sending = delivery.send({ message: "Hello" }, {
    messageId: "one", deliver: () => request.promise, receiptTurns: receipts, uncertainOnError: true
  });
  receipts.value = [{ user: { messageId: "one", text: "Hello" } }];
  await nextTick();
  assert.deepEqual(await sending, { ok: true });
  assert.equal(delivery.find("one").status, "accepted");
  request.reject(new Error("The old HTTP connection closed."));
  await nextTick();
  assert.equal(delivery.find("one").error, "");
  delivery.reconcile(receipts.value);
  assert.deepEqual(delivery.turns(receipts.value), receipts.value);
});

test("provisional authored rows remain visible without settling delivery or restored retries", async () => {
  const request = Promise.withResolvers();
  const receipts = ref([]);
  const payload = { message: "Original", displayAttachments: [{ attachmentId: "original" }] };
  let acknowledgements = 0;
  let submissions = 0;
  let settled = false;
  const delivery = createAssistantMessageDelivery();
  const sending = delivery.send(payload, {
    messageId: "one", receiptTurns: receipts,
    deliver() { submissions += 1; return request.promise; },
    onAccepted() { acknowledgements += 1; }
  });
  void sending.then(() => { settled = true; }, () => { settled = true; });
  const turn = normalizeConversationTurn({ turnId: "saved", user: {
    role: "user", messageId: "one", text: "Original", receipt: false, attachments: payload.displayAttachments
  } });
  receipts.value = [turn];
  delivery.reconcile(receipts.value);
  await nextTick();
  assert.equal(settled, false);
  assert.equal(acknowledgements, 0);
  assert.equal(delivery.turns(receipts.value).length, 1);
  assert.equal(delivery.turns(receipts.value)[0].optimistic.status, "pending");
  assert.equal(delivery.turns(receipts.value)[0].user.receipt, false);
  const rejected = assert.rejects(sending, /Native history unavailable/);
  request.reject(Object.assign(new Error("Native history unavailable"), { status: "uncertain" }));
  await rejected;
  delivery.reconcile(receipts.value);
  assert.equal(delivery.find("one").status, "uncertain");
  assert.equal(delivery.turns(receipts.value)[0].system.delivery.messageId, "one");
  assert.equal(delivery.resend("one"), false);
  assert.equal(await delivery.send(payload, { messageId: "one" }), false);
  assert.equal(submissions, 1);
  assert.deepEqual(delivery.find("one").payload, payload);
  assert.equal(unmatchedOptimisticMessages(receipts.value, delivery.state.messages, { receiptsOnly: true }).length, 1);
  const restored = createAssistantMessageDelivery();
  assert.equal(restored.restoreUncertain({ messageId: "one", text: "Original", attachments: payload.displayAttachments }, receipts.value), true);
  assert.equal(restored.turns(receipts.value).length, 1);
  assert.equal(restored.turns(receipts.value)[0].optimistic.status, "uncertain");
  const admitted = { ...turn, user: { ...turn.user } };
  delete admitted.user.receipt;
  delivery.reconcile([admitted]);
  delivery.reconcile([admitted]);
  assert.equal(acknowledgements, 1);
  assert.equal(delivery.state.messages.length, 0);
  assert.equal(submissions, 1);
});

test("an exact HTTP admission can retire its still provisional displayed row", async () => {
  let acknowledgements = 0;
  const delivery = createAssistantMessageDelivery({ deliver: async () => ({ ok: true, delivered: true }) });
  await delivery.send({ message: "Accepted" }, { messageId: "one", onAccepted() { acknowledgements += 1; } });
  const provisional = { turnId: "saved", user: { messageId: "one", text: "Accepted", receipt: false } };
  delivery.reconcile([provisional]);
  assert.deepEqual(delivery.turns([provisional]), [provisional]);
  assert.equal(delivery.state.messages.length, 0);
  assert.equal(acknowledgements, 1);
});

test("a late canonical receipt acknowledges captured attachments once after an uncertain HTTP response", async () => {
  let ready = ["original"];
  let acknowledgements = 0;
  const delivery = createAssistantMessageDelivery({ deliver: async () => { throw new Error("Receipt lost."); } });
  const payload = { message: "", displayAttachments: [{ attachmentId: "original" }] };
  await assert.rejects(delivery.send(payload, {
    messageId: "one", uncertainOnError: true,
    onAccepted() { acknowledgements += 1; ready = ready.filter(id => id !== "original"); }
  }), /Receipt lost/);
  ready.push("newer");
  assert.equal(acknowledgements, 0);
  assert.equal(Object.values(delivery.find("one")).some(value => typeof value === "function"), false);
  assert.deepEqual(delivery.find("one").payload, payload);
  delivery.reconcile([{ user: { messageId: "another", text: "" } }]);
  assert.equal(acknowledgements, 0);
  const receipt = { user: { messageId: "one", text: "", attachments: payload.displayAttachments } };
  delivery.reconcile([receipt]);
  delivery.accept("one");
  delivery.reconcile([receipt]);
  assert.deepEqual(ready, ["newer"]);
  assert.equal(acknowledgements, 1);
  assert.deepEqual(delivery.state.messages, []);
});

test("a canonical receipt acknowledges attachments before HTTP completes and late failure cannot repeat it", async () => {
  const request = Promise.withResolvers();
  const receipts = ref([]);
  const delivery = createAssistantMessageDelivery();
  let acknowledgements = 0;
  const sending = delivery.send({ message: "See the file", displayAttachments: [{ attachmentId: "original" }] }, {
    messageId: "one", deliver: () => request.promise, receiptTurns: receipts, uncertainOnError: true,
    onAccepted() { acknowledgements += 1; }
  });
  receipts.value = [{ user: { messageId: "one", text: "See the file" } }];
  delivery.reconcile(receipts.value);
  assert.equal(acknowledgements, 1);
  assert.deepEqual(await sending, { ok: true });
  request.reject(new Error("Late HTTP failure."));
  await nextTick();
  delivery.accept("one");
  assert.equal(acknowledgements, 1);
  assert.equal(delivery.state.sending, false);
});

test("retry preserves the original attachment owner and inspection can acknowledge an uncertain entry", async () => {
  const sent = [];
  const owners = [];
  const delivery = createAssistantMessageDelivery({ deliver: async payload => {
    sent.push(payload);
    return sent.length === 1 ? { ok: false, error: "Rejected before admission." } : { ok: true };
  } });
  const payload = { message: "Retry this file", displayAttachments: [{ attachmentId: "original" }] };
  await delivery.send(payload, { messageId: "one", onAccepted: () => owners.push("original") });
  await delivery.send(payload, { messageId: "one", onAccepted: () => owners.push("newer") });
  assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(owners, ["original"]);
  delivery.accept("one");
  assert.deepEqual(owners, ["original"]);

  await assert.rejects(delivery.send({ message: "Check receipt" }, {
    messageId: "uncertain", uncertainOnError: true, deliver: async () => { throw new Error("Offline"); },
    onAccepted: () => owners.push("inspected")
  }), /Offline/);
  delivery.accept("uncertain");
  delivery.accept("uncertain");
  assert.deepEqual(owners, ["original", "inspected"]);
});

test("unconfirmed delivery preserves its authored payload for inspection without replay or edit controls", async () => {
  const sent = [];
  const delivery = createAssistantMessageDelivery({ deliver: async payload => {
    sent.push(payload);
    throw new Error("Connection closed.");
  } });
  const payload = { message: "Hello", displayAttachments: [{ attachmentId: "file", name: "Original" }] };
  await assert.rejects(delivery.send(payload, { messageId: "one", uncertainOnError: true }), /Connection closed/);
  payload.displayAttachments[0].name = "Changed";
  const [turn] = delivery.turns();
  assert.equal(turn.optimistic.status, "uncertain");
  assert.equal(turn.user.attachments[0].name, "Original");
  assert.deepEqual(turn.system.delivery, { messageId: "one", error: "Connection closed.", checking: false });
  assert.equal(delivery.cancel("one"), false);
  assert.equal(delivery.edit("one", "New draft"), null);
  assert.equal(delivery.resend("one"), false);
  assert.equal(await delivery.send({ message: "Hello" }, { messageId: "one" }), false);
  assert.equal(sent.length, 1);
  delivery.accept("one");
  assert.equal(delivery.find("one").status, "accepted");
  assert.equal(delivery.find("one").error, "");
  assert.equal(delivery.restoreUncertain({ messageId: "one", text: "Hello", error: "Stale error" }), false);
  assert.equal(delivery.turns()[0].system, undefined);
});

test("reconnect restores one uncertain request and ends its HTTP wait without dispatching again", async () => {
  const request = Promise.withResolvers();
  const receipts = ref([]);
  let sends = 0;
  const delivery = createAssistantMessageDelivery();
  const sending = delivery.send({ message: "Hello" }, {
    messageId: "one", receiptTurns: receipts, uncertainOnError: true,
    deliver: () => { sends += 1; return request.promise; }
  });
  const pendingRequest = { messageId: "one", text: "Hello", error: "Delivery is unconfirmed." };
  assert.equal(delivery.restoreUncertain(pendingRequest), true);
  assert.deepEqual(await sending, { ok: false, status: "uncertain", error: pendingRequest.error });
  delivery.restoreUncertain(pendingRequest);
  assert.equal(delivery.state.messages.length, 1);
  assert.equal(delivery.state.sending, false);
  assert.equal(sends, 1);
  request.reject(new Error("Late transport failure"));
  await nextTick();
  assert.equal(delivery.find("one").error, pendingRequest.error);
  const receipt = { user: { messageId: "one", text: "Hello" } };
  delivery.reconcile([receipt]);
  assert.equal(delivery.restoreUncertain(pendingRequest, [receipt]), false);
  assert.deepEqual(delivery.turns([receipt]), [receipt]);
});

test("an uncertain predecessor leaves queued guidance unsent and safely retryable", async () => {
  const request = Promise.withResolvers();
  const sent = [];
  const delivery = createAssistantMessageDelivery({ deliver: payload => {
    sent.push(payload.messageId);
    return request.promise;
  } });
  const first = delivery.send({ message: "First" }, { messageId: "one", uncertainOnError: true });
  const second = delivery.send({ message: "Second" }, { messageId: "two", uncertainOnError: true, queue: true });
  const rejected = assert.rejects(first, /Connection lost/);
  request.reject(new Error("Connection lost"));
  await rejected;
  assert.equal(await second, false);
  assert.deepEqual(sent, ["one"]);
  assert.equal(delivery.find("one").status, "uncertain");
  assert.equal(delivery.find("two").status, "failed");
  assert.match(delivery.find("two").error, /Check the previous message/);
});

test("restored application requests retain their origin and attachment-only user messages remain empty", async () => {
  const delivery = createAssistantMessageDelivery();
  delivery.restoreUncertain({ messageId: "wake", origin: "application", text: "Continue the goal.", at: "2026-01-01T00:00:00Z" });
  const [restored] = delivery.turns();
  assert.equal(restored.user, undefined);
  assert.equal(restored.system.messageId, "wake");
  assert.match(restored.system.text, /Continue the goal/);
  delivery.reconcile([{ system: { messageId: "wake", text: "Continue the goal." } }]);
  assert.equal(delivery.state.messages.length, 0);
  await delivery.send({ message: "", displayAttachments: [{ attachmentId: "image" }] }, {
    messageId: "image-only", deliver: async () => ({ status: "accepted" })
  });
  assert.equal(delivery.turns()[0].user.text, "");
  assert.deepEqual(delivery.turns()[0].user.attachments, [{ attachmentId: "image" }]);
});
