import assert from "node:assert/strict";
import test from "node:test";
import { conversationAgentRunEvent, conversationAgentRunRecord, createCodexConversationRunStore, createCodexConversationStore } from "../src/server/conversation/agentRun.js";
import { createMemoryConversationStorage } from "../src/server/conversation/memoryStorage.js";
import { createReentrantConversationStorage } from "../src/server/conversation/storage.js";
import { createConversationTranscript } from "../src/server/conversation/transcript.js";
import { createConversationStreams } from "../src/server/conversation/streams.js";

const scope = "actor:workspace:conversation";
const runId = "codex_app_server";
const start = "2026-10-01T01:00:00.000Z";
const finish = "2026-10-01T01:00:01.000Z";

async function fixture() {
  const memory = createMemoryConversationStorage();
  let writes = 0;
  const storage = createReentrantConversationStorage({
    ...memory,
    write(id, operation) { writes += 1; return memory.write(id, operation); }
  });
  await storage.write(scope, transaction => transaction.writeMetadata({
    product: { retained: true },
    runtime: { version: 3, engine: "codex", segmentId: "segment-one", binding: { threadId: "native-thread" },
      request: { messageId: "authored-request", message: "Frozen native prompt", attempted: true } }
  }));
  let current = true;
  const store = createCodexConversationRunStore({ storage, scope, segmentId: "segment-one",
    isCurrent: () => current, clock: () => new Date(start) });
  return { storage, store, writes: () => writes, retire: () => { current = false; } };
}

test("original run updater retains event, timestamp, state and unknown-field semantics", () => {
  const initial = conversationAgentRunEvent({ id: runId, events: [], extension: { preserved: true } }, runId, {
    event: { at: ` ${start} `, kind: " claim ", message: " event message ", extra: "event extension" },
    patch: { state: " active ", message: "patch message", updatedAt: finish, startedAt: start,
      providerThreadId: "native-thread", providerTurnId: "native-turn", outerTurnId: "outer-turn", error: "explicit" }
  });
  assert.deepEqual(initial, {
    id: runId, events: [{ at: start, kind: "claim", message: "event message", extra: "event extension", state: "active" }],
    extension: { preserved: true }, state: "active", message: "patch message", updatedAt: start, startedAt: start,
    providerThreadId: "native-thread", providerTurnId: "native-turn", outerTurnId: "outer-turn", error: "explicit",
    active: true, finishedAt: ""
  });
  const completed = conversationAgentRunEvent(initial, runId, {
    event: { state: "failed", kind: "", message: "" },
    patch: { state: "completed", updatedAt: finish, startedAt: finish, message: " complete ", finishedAt: finish }
  });
  assert.equal(completed.active, false);
  assert.equal(completed.startedAt, start);
  assert.equal(completed.finishedAt, finish);
  assert.equal(completed.error, "explicit");
  assert.deepEqual(completed.events, [...initial.events,
    { state: "completed", kind: "completed", message: "complete", at: finish }]);
  const next = conversationAgentRunEvent(completed, runId, { patch: { state: "starting" } }, { now: () => new Date(finish) });
  assert.equal(next.startedAt, start);
  assert.equal(next.finishedAt, "");
  assert.equal(next.error, "");
  assert.equal(next.active, true);
  assert.deepEqual(next.extension, initial.extension);
  for (const state of ["cancelled", "completed", "failed", "interrupted", "timed_out"]) {
    const terminal = conversationAgentRunEvent(completed, runId, { patch: { state } }, { now: () => new Date(start) });
    assert.equal(terminal.active, false);
    assert.equal(terminal.finishedAt, finish);
  }
  assert.equal(conversationAgentRunEvent(initial, runId, { patch: { state: "active", error: null } }).error, null);
});

test("original run reader preserves unknown fields and filters events without inventing a run", async () => {
  const f = await fixture();
  const before = f.writes();
  assert.equal(await f.store.readAgentRun(scope, runId), null);
  assert.deepEqual(await f.store.getSession(scope), { sessionId: scope, agentRuns: [] });
  assert.equal(f.writes(), before);
  for (const value of [undefined, null, [], "invalid"]) assert.equal(conversationAgentRunRecord(value, runId), null);
  assert.deepEqual(conversationAgentRunRecord({ id: "ignored", active: false, events: [null, [], "invalid", { kind: "saved" }],
    pendingUserMessageClientIds: ["request"], extension: { one: 1 } }, runId), {
    id: runId, active: true, events: [{ kind: "saved" }], state: "starting",
    pendingUserMessageClientIds: ["request"], extension: { one: 1 }
  });
  for (const state of ["unknown", false, 0]) {
    assert.throws(() => conversationAgentRunRecord({ state }, runId), { code: "codex_app_server_invalid_run_state" });
  }
});

test("native run mutation joins transcript writes and reads in one existing transaction", { timeout: 3_000 }, async () => {
  const f = await fixture();
  const transcript = createConversationTranscript({ storage: f.storage });
  const before = f.writes();
  const result = await f.store.mutateSession(scope, async () => {
    assert.deepEqual(await f.store.getSession(scope), { sessionId: scope, agentRuns: [] });
    await transcript.writeConversationUserMessage(scope, { messageId: "authored-request", text: "Authored message" });
    const run = await f.store.writeAgentRunEvent(scope, runId, {
      event: { kind: "claimed", at: start },
      patch: { state: "starting", outerTurnId: "outer-turn", pendingUserMessageClientIds: ["authored-request"], retained: [1, 2] }
    });
    assert.deepEqual((await f.store.getSession(scope)).agentRuns, [run]);
    assert.equal((await transcript.readConversationLog(scope))[0].user.text, "Authored message");
    return run;
  });
  assert.equal(f.writes(), before + 1, "Nested native and transcript operations use one host writer call.");
  const saved = await f.storage.read(scope, transaction => transaction.readMetadata());
  assert.deepEqual(saved.runtime.binding.codexAppServerRun, result);
  assert.deepEqual(saved.runtime.request, { messageId: "authored-request", message: "Frozen native prompt", attempted: true });
  assert.deepEqual(saved.product, { retained: true });
  result.retained.push(3);
  assert.deepEqual((await f.store.readAgentRun(scope, runId)).retained, [1, 2]);
  await assert.rejects(f.store.mutateSession(scope, async () => {
    await f.store.writeAgentRunEvent(scope, runId, { patch: { state: "active", providerTurnId: "uncommitted" } });
    await transcript.writeConversationAssistantMessage(scope, { text: "Uncommitted answer" });
    throw new Error("commit refused");
  }), /commit refused/);
  assert.equal((await f.store.readAgentRun(scope, runId)).providerTurnId, undefined);
  assert.equal((await transcript.readConversationLog(scope))[0].assistant, null);
});

test("original active-participant lease drains nested work and queues escaped callbacks", { timeout: 3_000 }, async () => {
  const f = await fixture();
  const nestedEntered = Promise.withResolvers();
  const nestedRelease = Promise.withResolvers();
  const escapedRelease = Promise.withResolvers();
  let nested, escaped;
  let outerFinished = false;
  const before = f.writes();
  const outer = f.storage.write(scope, async transaction => {
    const metadata = await transaction.readMetadata();
    metadata.outer = true;
    await transaction.writeMetadata(metadata);
    escaped = escapedRelease.promise.then(() => f.storage.write(scope, async current => {
      const latest = await current.readMetadata();
      latest.escaped = true;
      await current.writeMetadata(latest);
    }));
    nested = f.storage.write(scope, async current => {
      nestedEntered.resolve();
      await nestedRelease.promise;
      const latest = await current.readMetadata();
      latest.nested = true;
      await current.writeMetadata(latest);
    });
  }).then(() => { outerFinished = true; });
  await nestedEntered.promise;
  // This independent scope must not borrow another scope's active draft.
  await f.storage.write("other", transaction => transaction.writeMetadata({ other: true }));
  assert.equal(outerFinished, false);
  nestedRelease.resolve();
  await Promise.all([outer, nested]);
  assert.equal(f.writes(), before + 2);
  escapedRelease.resolve();
  await escaped;
  assert.equal(f.writes(), before + 3, "An inactive inherited participant must re-enter the host queue.");
  const saved = await f.storage.read(scope, transaction => transaction.readMetadata());
  assert.equal(saved.outer, true);
  assert.equal(saved.nested, true);
  assert.equal(saved.escaped, true);
  assert.equal(saved.other, undefined);
  assert.deepEqual(await f.storage.read("other", transaction => transaction.readMetadata()), { other: true });
});

test("native run mutation refuses stale owners, changed segments and cross-conversation access", { timeout: 3_000 }, async () => {
  const f = await fixture();
  await f.store.writeAgentRunEvent(scope, runId, { patch: { state: "completed", providerTurnId: "old-turn" } });
  await assert.rejects(f.store.readAgentRun("other", runId), /another conversation/);
  await assert.rejects(f.store.writeAgentRunEvent(scope, "another-run", {}), /only its Codex/);
  const blocked = Promise.withResolvers();
  const release = Promise.withResolvers();
  const changing = f.storage.write(scope, async transaction => {
    blocked.resolve();
    await release.promise;
    const metadata = await transaction.readMetadata();
    metadata.runtime.segmentId = "successor";
    metadata.runtime.binding = { threadId: "successor-thread" };
    await transaction.writeMetadata(metadata);
  });
  await blocked.promise;
  const stale = f.store.writeAgentRunEvent(scope, runId, { patch: { state: "active" } });
  release.resolve();
  await changing;
  await assert.rejects(stale, /retired native conversation/);
  assert.deepEqual((await f.storage.read(scope, transaction => transaction.readMetadata())).runtime.binding,
    { threadId: "successor-thread" });
  f.retire();
  await assert.rejects(f.store.writeAgentRunEvent(scope, runId, {}), /retired provider/);
});


test("late native authored receipts retain their exact request after the durable request changes", async () => {
  const f = await fixture();
  const transcript = createConversationTranscript({ storage: f.storage });
  const store = createCodexConversationStore({ storage: f.storage, scope, segmentId: "segment-one",
    isCurrent: () => true, transcript, streams: createConversationStreams() });
  const authoredRequest = { messageId: "late-authored", text: "Original authorized message", origin: "application", at: start,
    data: { request: "original" }, attachments: [{ attachmentId: "receipt", fileName: "saved.png", size: 4 }] };
  await f.storage.write(scope, async transaction => {
    const metadata = await transaction.readMetadata();
    metadata.runtime.request = { messageId: "new-request", text: "A different request", data: { request: "new" } };
    await transaction.writeMetadata(metadata);
  });
  const written = await store.writeConversationUserMessage(scope, {
    messageId: authoredRequest.messageId, text: "Rendered native text is not the authored message",
    authoredRequest, nativeIdentity: { threadId: "native-thread", turnId: "accepted-turn" }
  });
  assert.equal(written.system.text, authoredRequest.text);
  assert.equal(written.system.at, start);
  assert.deepEqual(written.system.data, authoredRequest.data);
  assert.deepEqual(written.system.attachments, authoredRequest.attachments);
  assert.equal(written.metadata.runtime.segmentId, "segment-one");
  assert.equal(written.metadata.runtime.origin, "application");
  assert.equal(written.metadata.runtime.nativeTurnId, "accepted-turn");
  assert.equal(JSON.stringify(written).includes("nativeIdentity"), false);
  assert.equal(JSON.stringify(written).includes("Rendered native"), false);
  assert.equal(await store.writeConversationUserMessage(scope, { messageId: authoredRequest.messageId, authoredRequest }), null);
  assert.equal((await transcript.readConversationLog(scope)).length, 1);
  assert.equal((await f.storage.read(scope, transaction => transaction.readMetadata())).runtime.request.messageId, "new-request");
});

test("native output uses its exact notification identity after the stored run advances", async () => {
  const f = await fixture();
  const transcript = createConversationTranscript({ storage: f.storage });
  const store = createCodexConversationStore({ storage: f.storage, scope, segmentId: "segment-one",
    isCurrent: () => true, transcript, streams: createConversationStreams() });
  await store.writeAgentRunEvent(scope, runId, { patch: {
    state: "active", providerThreadId: "native-thread", providerTurnId: "successor-turn"
  } });
  const written = await store.writeConversationAssistantMessage(scope, {
    messageId: "native-response", text: "Exact earlier response",
    nativeIdentity: { threadId: "native-thread", turnId: "earlier-turn" }
  });
  assert.equal(written.metadata.runtime.nativeTurnId, "earlier-turn");
  assert.equal(written.metadata.runtime.origin, undefined);
  assert.equal(JSON.stringify(written).includes("nativeIdentity"), false);
  assert.equal((await store.readAgentRun(scope, runId)).providerTurnId, "successor-turn");
  const corrected = await store.upsertConversationAssistantMessage(scope, {
    turnId: written.turnId, text: "Exact corrected response",
    nativeIdentity: { threadId: "native-thread", turnId: "earlier-turn" }
  });
  assert.equal(corrected.metadata.runtime.nativeTurnId, "earlier-turn");
  assert.equal(corrected.assistant.text, "Exact corrected response");
  assert.equal((await transcript.readConversationLog(scope)).length, 1);
});

test("native stream origin uses only its exact authorized pending request before the authored row exists", async () => {
  for (const origin of ["user", "application"]) {
    const f = await fixture();
    const transcript = createConversationTranscript({ storage: f.storage, applicationTurns: true });
    const store = createCodexConversationStore({ storage: f.storage, scope, segmentId: "segment-one",
      isCurrent: () => true, transcript, streams: createConversationStreams() });
    const nativeIdentity = { threadId: "native-thread", turnId: "native-turn" };
    await f.storage.write(scope, async transaction => {
      const metadata = await transaction.readMetadata();
      metadata.runtime.request.origin = origin;
      await transaction.writeMetadata(metadata);
    });
    await store.writeAgentRunEvent(scope, runId, { patch: { state: "active",
      providerThreadId: nativeIdentity.threadId, providerTurnId: nativeIdentity.turnId, outerTurnId: "authored-request" } });
    const stream = await store.updateConversationStream(scope, { nativeIdentity,
      turnId: "native-thread:native-turn", messageId: "first-live-reply", text: "Reply before receipt" });
    assert.equal(stream.messages[0].origin, origin);
    assert.equal(Object.hasOwn(stream.messages[0], "turnId"), false);
    assert.equal(JSON.stringify(stream).includes("nativeIdentity"), false);
    assert.deepEqual(await transcript.readConversationLog(scope), []);
    for (const identity of [{ threadId: "another-thread", turnId: "native-turn" },
      { threadId: "native-thread", turnId: "earlier-turn" }]) {
      const unproven = await store.updateConversationStream(scope, { nativeIdentity: identity,
        turnId: `${identity.threadId}:${identity.turnId}`, messageId: "unproven", text: "Unproven reply" });
      assert.equal(unproven.messages[0].origin, undefined);
      assert.equal(Object.hasOwn(unproven.messages[0], "turnId"), false);
    }
    await f.storage.write(scope, async transaction => {
      const metadata = await transaction.readMetadata();
      metadata.runtime.request.messageId = "unrelated-pending-request";
      await transaction.writeMetadata(metadata);
    });
    const unrelated = await store.updateConversationStream(scope, { nativeIdentity,
      turnId: "native-thread:native-turn", messageId: "unrelated", text: "No matching request" });
    assert.equal(unrelated.messages[0].origin, undefined);
    assert.equal(Object.hasOwn(unrelated.messages[0], "turnId"), false);
    assert.deepEqual(await transcript.readConversationLog(scope), []);
  }
});

test("native output origin joins only its exact outer authored request and preserves saved grouping", async () => {
  for (const origin of ["user", "application"]) {
    const f = await fixture();
    const transcript = createConversationTranscript({ storage: f.storage, applicationTurns: true });
    const streams = createConversationStreams();
    const store = createCodexConversationStore({ storage: f.storage, scope, segmentId: "segment-one",
      isCurrent: () => true, transcript, streams });
    const nativeIdentity = { threadId: "native-thread", turnId: "native-turn" };
    const authoredRequest = { messageId: "outer-request", text: "Authorized request", origin };
    const authored = await store.writeConversationUserMessage(scope, {
      messageId: authoredRequest.messageId, authoredRequest, nativeIdentity
    });
    await store.writeAgentRunEvent(scope, runId, { patch: { state: "active",
      providerThreadId: nativeIdentity.threadId, providerTurnId: nativeIdentity.turnId, outerTurnId: authoredRequest.messageId } });
    const streaming = await store.updateConversationStream(scope, { nativeIdentity,
      turnId: "native-thread:native-turn", messageId: "live-reply", text: "Live reply" });
    assert.equal(streaming.messages[0].origin, origin);
    assert.equal(Object.hasOwn(streaming.messages[0], "turnId"), false);
    assert.equal(JSON.stringify(streaming).includes("nativeIdentity"), false);
    const first = await store.writeConversationAssistantMessage(scope, {
      nativeIdentity, messageId: "first-reply", text: "First reply"
    });
    const second = await store.writeConversationAssistantMessage(scope, {
      nativeIdentity, messageId: "second-reply", text: "Second reply"
    });
    assert.equal(first.turnId, authored.turnId);
    assert.notEqual(second.turnId, authored.turnId);
    assert.equal(second.user, null);
    assert.equal(second.system, undefined);
    assert.equal(second.metadata.runtime.origin, origin);
    assert.equal((await transcript.readConversationLog(scope)).length, 2);
    for (const identity of [{ threadId: "another-thread", turnId: "native-turn" },
      { threadId: "native-thread", turnId: "earlier-turn" }]) {
      const snapshot = await store.updateConversationStream(scope, { nativeIdentity: identity,
        turnId: `${identity.threadId}:${identity.turnId}`, messageId: "unproven", text: "Unproven reply" });
      assert.equal(snapshot.messages[0].origin, undefined);
      assert.equal(Object.hasOwn(snapshot.messages[0], "turnId"), false);
    }
    await f.storage.write(scope, transaction => transaction.updateTurnMetadata(authored.turnId,
      { runtime: { ...authored.metadata.runtime, segmentId: "another-segment" } }));
    const unowned = await store.writeConversationAssistantMessage(scope, {
      nativeIdentity, messageId: "unowned-reply", text: "Reply without a matching authored segment"
    });
    assert.equal(unowned.metadata.runtime.origin, undefined);
  }
});


test("native completed text uses the exact authored row without changing saved or public stream grouping", async () => {
  for (const origin of ["user", "application"]) {
    const f = await fixture();
    let current = true;
    const transcript = createConversationTranscript({ storage: f.storage, applicationTurns: true });
    const streams = createConversationStreams();
    const store = createCodexConversationStore({ storage: f.storage, scope, segmentId: "segment-one",
      isCurrent: () => current, transcript, streams });
    const nativeIdentity = { threadId: "native-thread", turnId: "native-turn" };
    const authoredRequest = { messageId: "outer-request", text: "Exact authored request", origin };
    const row = await store.writeConversationUserMessage(scope, { messageId: authoredRequest.messageId, authoredRequest, nativeIdentity });
    await store.writeAgentRunEvent(scope, runId, { patch: { state: "active", providerThreadId: nativeIdentity.threadId,
      providerTurnId: nativeIdentity.turnId, outerTurnId: authoredRequest.messageId } });
    const before = await transcript.readConversationLog(scope);
    const live = await store.updateConversationStream(scope, { nativeIdentity, turnId: "native-thread:native-turn",
      messageId: "native-item", outputId: "native-item", role: "commentary", delta: "Partial" });
    assert.equal(live.messages[0].origin, origin);
    assert.equal(Object.hasOwn(live.messages[0], "turnId"), false);
    assert.equal(JSON.stringify(live).includes("nativeIdentity"), false);
    const completed = store.completeConversationStreamMessage(scope, "native-item", { text: "Exact completed sentence" });
    assert.equal(completed.completedMessages[0].turnId, row.turnId);
    assert.equal(completed.completedMessages[0].origin, origin);
    assert.equal(completed.completedMessages[0].text, "Exact completed sentence");
    assert.equal(completed.completedMessages[0].status, "complete");
    assert.deepEqual(await transcript.readConversationLog(scope), before, "Completion adds no canonical commentary row");
    assert.equal(streams.read(scope).completedMessages, undefined);
    assert.equal(store.completeConversationStreamMessage(scope, "native-item", { text: "Repeated" }).completedMessages, undefined);
    current = false;
    assert.throws(() => store.completeConversationStreamMessage(scope, "native-item", { text: "Retired" }), /retired provider/);
  }
});

test("pending native custody gains only its same authored row and never a successor's identity", async () => {
  for (const sameRequest of [true, false]) {
    const f = await fixture();
    const transcript = createConversationTranscript({ storage: f.storage, applicationTurns: true });
    const store = createCodexConversationStore({ storage: f.storage, scope, segmentId: "segment-one",
      isCurrent: () => true, transcript, streams: createConversationStreams() });
    const nativeIdentity = { threadId: "native-thread", turnId: "native-turn" };
    await f.storage.write(scope, async transaction => {
      const metadata = await transaction.readMetadata(); metadata.runtime.request.origin = "user";
      await transaction.writeMetadata(metadata);
    });
    await store.writeAgentRunEvent(scope, runId, { patch: { state: "active", providerThreadId: nativeIdentity.threadId,
      providerTurnId: nativeIdentity.turnId, outerTurnId: "authored-request" } });
    const input = { nativeIdentity, turnId: "native-thread:native-turn", messageId: "early-item", role: "commentary" };
    await store.updateConversationStream(scope, { ...input, delta: "Early" });
    const messageId = sameRequest ? "authored-request" : "successor";
    const row = await store.writeConversationUserMessage(scope, { messageId,
      authoredRequest: { messageId, text: "Admitted request", origin: "user" }, nativeIdentity });
    await store.writeAgentRunEvent(scope, runId, { patch: { outerTurnId: messageId } });
    await store.updateConversationStream(scope, { ...input, delta: " complete" });
    const completed = store.completeConversationStreamMessage(scope, input.messageId, { text: "Completed early item" });
    assert.equal(completed.completedMessages?.[0]?.turnId, sameRequest ? row.turnId : undefined);
    assert.equal((await transcript.readConversationLog(scope)).flatMap(turn => turn.commentary || []).length, 0);
  }
});

test("captured native predecessor commentary cannot be reassigned by same-turn steering", async () => {
  const f = await fixture();
  const transcript = createConversationTranscript({ storage: f.storage, applicationTurns: true });
  const store = createCodexConversationStore({ storage: f.storage, scope, segmentId: "segment-one",
    isCurrent: () => true, transcript, streams: createConversationStreams() });
  const nativeIdentity = { threadId: "native-thread", turnId: "native-turn" };
  const authored = async messageId => store.writeConversationUserMessage(scope, { messageId,
    authoredRequest: { messageId, text: messageId, origin: "user" }, nativeIdentity });
  const first = await authored("predecessor");
  await store.writeAgentRunEvent(scope, runId, { patch: { state: "active", providerThreadId: nativeIdentity.threadId,
    providerTurnId: nativeIdentity.turnId, outerTurnId: "predecessor" } });
  const input = { nativeIdentity, turnId: "native-thread:native-turn", messageId: "old-item", role: "commentary" };
  await store.updateConversationStream(scope, { ...input, delta: "Original intent" });
  const successor = await authored("successor");
  await store.writeAgentRunEvent(scope, runId, { patch: { outerTurnId: "successor" } });
  await store.updateConversationStream(scope, { ...input, delta: " late words" });
  assert.equal(store.completeConversationStreamMessage(scope, input.messageId, { text: "Original completed intent" })
    .completedMessages[0].turnId, first.turnId);
  await store.updateConversationStream(scope, { ...input, messageId: "new-item", delta: "Successor intent" });
  assert.equal(store.completeConversationStreamMessage(scope, "new-item", { text: "Successor completed intent" })
    .completedMessages[0].turnId, successor.turnId);
  const unproven = await store.updateConversationStream(scope, { ...input, messageId: "foreign-item",
    nativeIdentity: { ...nativeIdentity, threadId: "foreign-thread" }, delta: "Foreign" });
  assert.equal(unproven.messages[0].origin, undefined);
  assert.equal(store.completeConversationStreamMessage(scope, "foreign-item", { text: "Foreign" }).completedMessages, undefined);
});


test("a single pending native delta resolves only its captured same request at exact completion", async () => {
  for (const selected of ["same", "successor", "foreign", "changed-origin"]) {
    const f = await fixture();
    const transcript = createConversationTranscript({ storage: f.storage, applicationTurns: true });
    const store = createCodexConversationStore({ storage: f.storage, scope, segmentId: "segment-one",
      isCurrent: () => true, transcript, streams: createConversationStreams() });
    const nativeIdentity = { threadId: "native-thread", turnId: "native-turn" };
    await f.storage.write(scope, async transaction => {
      const metadata = await transaction.readMetadata(); metadata.runtime.request.origin = "user";
      await transaction.writeMetadata(metadata);
    });
    await store.writeAgentRunEvent(scope, runId, { patch: { state: "active", providerThreadId: nativeIdentity.threadId,
      providerTurnId: nativeIdentity.turnId, outerTurnId: "authored-request" } });
    await store.updateConversationStream(scope, { nativeIdentity, turnId: "native-thread:native-turn",
      messageId: "single-delta", role: "commentary", delta: "Early partial words" });
    const messageId = selected === "successor" ? "successor" : "authored-request";
    const row = await store.writeConversationUserMessage(scope, { messageId, nativeIdentity,
      authoredRequest: { messageId, text: "Admitted exact request", origin: selected === "changed-origin" ? "application" : "user" } });
    await store.writeAgentRunEvent(scope, runId, { patch: { outerTurnId: messageId } });
    const before = await transcript.readConversationLog(scope);
    const completed = await store.completeConversationStreamMessage(scope, "single-delta", {
      nativeIdentity: selected === "foreign" ? { ...nativeIdentity, threadId: "foreign-thread" } : nativeIdentity,
      text: "Exact completed intent", role: "commentary" });
    assert.equal(completed.completedMessages?.[0]?.turnId, selected === "same" ? row.turnId : undefined);
    if (selected === "same") {
      assert.equal(completed.completedMessages[0].text, "Exact completed intent");
      assert.equal(completed.completedMessages[0].origin, "user");
    }
    assert.deepEqual(await transcript.readConversationLog(scope), before);
    assert.equal((await store.completeConversationStreamMessage(scope, "single-delta", {
      nativeIdentity, text: "Repeat", role: "commentary" })).completedMessages, undefined);
  }
});


test("native envelope stream markers come only from exact current pending or authored metadata", async () => {
  for (const selected of ["pending", "authored", "foreign", "ordinary"]) {
    const f = await fixture();
    const transcript = createConversationTranscript({ storage: f.storage, applicationTurns: true });
    const store = createCodexConversationStore({ storage: f.storage, scope, segmentId: "segment-one",
      isCurrent: () => true, transcript, streams: createConversationStreams() });
    const nativeIdentity = { threadId: "native-thread", turnId: "native-turn" };
    await f.storage.write(scope, async tx => {
      const metadata = await tx.readMetadata();
      metadata.runtime.request.origin = "application";
      metadata.runtime.request.text = "Original internal prompt";
      if (selected !== "ordinary") metadata.runtime.request.completedEnvelope = true;
      await tx.writeMetadata(metadata);
    });
    if (selected === "authored") await store.writeConversationUserMessage(scope, {
      messageId: "authored-request", nativeIdentity, authoredRequest: { messageId: "authored-request", origin: "application", text: "Original internal prompt" }
    });
    await store.writeAgentRunEvent(scope, runId, { patch: { state: "active", providerThreadId: nativeIdentity.threadId,
      providerTurnId: nativeIdentity.turnId, outerTurnId: "authored-request" } });
    const stream = await store.updateConversationStream(scope, { nativeIdentity: selected === "foreign"
      ? { ...nativeIdentity, turnId: "foreign-turn" } : nativeIdentity,
      turnId: "native-thread:native-turn", messageId: "native-partial", text: "Partial internal JSON",
      completedEnvelope: true, data: { completedEnvelope: true } });
    assert.equal(stream.messages[0].completedEnvelope, ["pending", "authored"].includes(selected) ? true : undefined);
    assert.equal(Object.hasOwn(stream.messages[0], "turnId"), false);
    assert.equal(JSON.stringify(stream).includes("authored-request"), false);
    if (selected === "authored") {
      const completed = await store.completeConversationStreamMessage(scope, "native-partial", { nativeIdentity, text: "Exact internal final" });
      assert.equal(completed.completedMessages[0].completedEnvelope, true);
      assert.equal(completed.completedMessages[0].text, "Exact internal final");
    }
  }
});

test("marked native pending stream completion cannot borrow a successor's authored receipt", async () => {
  const f = await fixture();
  const transcript = createConversationTranscript({ storage: f.storage, applicationTurns: true });
  const store = createCodexConversationStore({ storage: f.storage, scope, segmentId: "segment-one",
    isCurrent: () => true, transcript, streams: createConversationStreams() });
  const nativeIdentity = { threadId: "native-thread", turnId: "native-turn" };
  await f.storage.write(scope, async tx => {
    const metadata = await tx.readMetadata();
    metadata.runtime.request.origin = "application";
    metadata.runtime.request.completedEnvelope = true;
    await tx.writeMetadata(metadata);
  });
  await store.writeAgentRunEvent(scope, runId, { patch: { state: "active", providerThreadId: nativeIdentity.threadId,
    providerTurnId: nativeIdentity.turnId, outerTurnId: "authored-request" } });
  const live = await store.updateConversationStream(scope, { nativeIdentity, turnId: "native-thread:native-turn",
    messageId: "captured-item", text: "Partial original" });
  assert.equal(live.messages[0].completedEnvelope, true);
  await store.writeConversationUserMessage(scope, { messageId: "successor", nativeIdentity,
    authoredRequest: { messageId: "successor", text: "New ordinary instruction", origin: "user" } });
  await store.writeAgentRunEvent(scope, runId, { patch: { outerTurnId: "successor" } });
  const completed = await store.completeConversationStreamMessage(scope, "captured-item", { nativeIdentity, text: "Late old final" });
  assert.equal(completed.completedMessages, undefined);
  assert.equal((await transcript.readConversationLog(scope))[0].user.messageId, "successor");
});
