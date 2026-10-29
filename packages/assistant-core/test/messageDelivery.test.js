import assert from "node:assert/strict";
import test from "node:test";
import { nextTick, ref } from "vue";
import { createAssistantMessageDelivery, draftWithRestoredMessage, unmatchedOptimisticMessages } from "../src/client/conversation/messageDelivery.js";
import { normalizeConversationTurn } from "../src/shared/conversation/patches.js";

test("proven no-admission releases only the exact uncertain message without accepting or losing its payload", async () => {
  let accepted = 0;
  const delivery = createAssistantMessageDelivery({ deliver: async () => { throw new Error("Connection lost"); } });
  const payload = { message: "Keep these words", displayAttachments: [{ attachmentId: "keep-file" }] };
  await assert.rejects(delivery.send(payload, { messageId: "not-sent", uncertainOnError: true, onAccepted: () => accepted++ }));
  delivery.restoreUncertain({ messageId: "still-unknown", text: "An attempted message" });
  assert.equal(delivery.rejectUnsent("different-id", "Not sent"), false);
  assert.equal(delivery.rejectUnsent("not-sent", "Not sent"), true);
  assert.equal(delivery.find("not-sent").status, "failed");
  assert.deepEqual(delivery.find("not-sent").payload, payload);
  assert.equal(delivery.find("still-unknown").status, "uncertain");
  assert.equal(accepted, 0);
  delivery.accept("not-sent");
  assert.equal(delivery.rejectUnsent("not-sent", "Not sent"), false);
  assert.equal(delivery.find("not-sent").status, "accepted");
  assert.equal(accepted, 1);
});

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
  assert.equal(delivery.find("two").cancelling, true, "Cancel waits for the server before removing it");
  delivery.remove("two");
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

test("a failed client-only message keeps its time while newer saved turns and pending messages follow it", async () => {
  const delivery = createAssistantMessageDelivery({ deliver: async () => ({ ok: false, error: "Unavailable" }) });
  await delivery.send({ message: "Lost" }, { messageId: "lost" });
  const sentAt = delivery.find("lost").createdAtMs;
  const earlier = { turnId: "1", user: { messageId: "earlier", text: "Earlier", at: new Date(sentAt - 1000).toISOString() } };
  const newer = { turnId: "2", user: { messageId: "newer", text: "Newer", at: new Date(sentAt + 1000).toISOString() }, pending: true };
  assert.deepEqual(delivery.turns([earlier, newer]).map(turn => turn.turnId), ["1", "lost", "2"]);
  assert.deepEqual(delivery.turns([earlier]).map(turn => turn.turnId), ["1", "lost"]);
  const waiting = Promise.withResolvers();
  const queued = createAssistantMessageDelivery({ deliver: () => waiting.promise });
  const sending = queued.send({ message: "Queued" }, { messageId: "queued" });
  assert.deepEqual(queued.turns([{ ...newer, user: { ...newer.user, at: new Date(Date.now() + 60000).toISOString() } }])
    .map(turn => turn.turnId), ["2", "queued"]);
  waiting.resolve({ ok: true });
  await sending;
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

test("Cancel keeps a pending, uncertain or failed message, shown as cancelling, until the server agrees", async () => {
  const delivery = createAssistantMessageDelivery();
  await delivery.send({ message: "Refused" }, { messageId: "failed", deliver: async () => ({ ok: false, error: "Refused." }) });
  await assert.rejects(delivery.send({ message: "Lost" }, { messageId: "uncertain", uncertainOnError: true,
    deliver: async () => { throw new Error("Internal server error."); } }), /Internal server error/);
  const held = Promise.withResolvers();
  const inFlight = delivery.send({ message: "In flight" }, { messageId: "pending", deliver: () => held.promise });
  assert.deepEqual(delivery.state.messages.map(message => message.status), ["failed", "uncertain", "pending"]);
  for (const messageId of ["failed", "uncertain", "pending"]) assert.equal(delivery.cancel(messageId), true);
  assert.deepEqual(delivery.turns().map(turn => [turn.optimistic.id, turn.optimistic.cancelling]),
    [["failed", true], ["uncertain", true], ["pending", true]], "Nothing leaves on the client's own authority");
  assert.equal(delivery.cancel("uncertain"), false, "A second press waits for the same answer");
  assert.equal(delivery.edit("failed", ""), null, "A cancelling message is not edited");
  assert.equal(await delivery.send({ message: "Refused" }, { messageId: "failed" }), false, "nor sent again");
  let queuedDeliveries = 0;
  const queued = delivery.send({ message: "Queued" }, { messageId: "queued", queue: true, deliver: async () => { queuedDeliveries += 1; } });
  assert.equal(delivery.cancel("queued"), true);
  held.resolve({ ok: false, error: "Late failure." });
  await inFlight;
  assert.equal(await queued, false);
  assert.equal(queuedDeliveries, 0, "A message cancelled while queued is never delivered");
  assert.equal(delivery.find("pending").cancelling, true, "A late answer leaves the cancel in progress");
  // The server could not be reached: the message stays, with Cancel again.
  delivery.cancelFailed("uncertain");
  assert.deepEqual(delivery.turns().find(turn => turn.optimistic.id === "uncertain").optimistic,
    { error: "Internal server error.", id: "uncertain", status: "uncertain", cancelError: "Couldn't reach the server — Cancel again" });
  assert.equal(delivery.cancel("uncertain"), true, "Cancel again");
  // The server agreed: only then does the caller remove each message.
  for (const messageId of ["failed", "uncertain", "pending", "queued"]) delivery.remove(messageId);
  assert.deepEqual(delivery.turns(), []);
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

test("a deliberate new message can follow known uncertainty without resending the old request", async () => {
  const sent = [];
  const delivery = createAssistantMessageDelivery({ deliver: async payload => {
    sent.push(payload);
    if (payload.messageId === "old") throw new Error("Lost receipt");
    return { ok: true };
  } });
  await assert.rejects(delivery.send({ message: "Old request" }, { messageId: "old", uncertainOnError: true }));
  assert.equal(await delivery.send({ message: "Old request" }, { messageId: "old", uncertainOnError: true }), false);
  assert.deepEqual(await delivery.send({ message: "A new request" }, { messageId: "new", uncertainOnError: true }), { ok: true });
  assert.deepEqual(sent.map(message => message.messageId), ["old", "new"]);
  assert.equal(delivery.find("old").status, "uncertain");
  assert.equal(delivery.find("new").status, "accepted");
});

test("a restored message leads the draft once", () => {
  assert.equal(draftWithRestoredMessage("First", ""), "First");
  assert.equal(draftWithRestoredMessage("First", "New draft"), "First\n\nNew draft");
  assert.equal(draftWithRestoredMessage("First", "First\n\nNew draft"), "First\n\nNew draft");
});
