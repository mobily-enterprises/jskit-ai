import assert from "node:assert/strict";
import test from "node:test";
import {
  createRealtimeEventEnvelope,
  createRealtimeEventsBus,
  createTargetedChatEventEnvelope
} from "../src/realtimeEvents.js";

test("realtime events bus supports subscribe/unsubscribe happy path", () => {
  const bus = createRealtimeEventsBus();
  const received = [];

  const unsubscribe = bus.subscribe((eventEnvelope) => {
    received.push(eventEnvelope);
  });

  bus.publish({
    eventId: "evt_1"
  });
  assert.equal(received.length, 1);

  unsubscribe();
  bus.publish({
    eventId: "evt_2"
  });
  assert.equal(received.length, 1);
});

test("realtime events bus returns noop unsubscribe for non-function subscribers", () => {
  const bus = createRealtimeEventsBus();
  const noopUnsubscribe = bus.subscribe(null);

  assert.equal(typeof noopUnsubscribe, "function");
  noopUnsubscribe();

  let callCount = 0;
  bus.subscribe(() => {
    callCount += 1;
  });
  bus.publish({
    eventId: "evt_1"
  });

  assert.equal(callCount, 1);
});

test("realtime events bus isolates listener failures", () => {
  const bus = createRealtimeEventsBus();
  const received = [];

  bus.subscribe(() => {
    throw new Error("listener blew up");
  });
  bus.subscribe((eventEnvelope) => {
    received.push(eventEnvelope);
  });

  bus.publish({
    eventId: "evt_safe"
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].eventId, "evt_safe");
});

test("realtime events bus resetForTests clears all listeners", () => {
  const bus = createRealtimeEventsBus();
  let callCount = 0;
  bus.subscribe(() => {
    callCount += 1;
  });

  bus.publish({
    eventId: "evt_before"
  });
  bus.resetForTests();
  bus.publish({
    eventId: "evt_after"
  });

  assert.equal(callCount, 1);
});

test("createRealtimeEventEnvelope applies deterministic field normalization", () => {
  const envelope = createRealtimeEventEnvelope({
    eventType: " workspace.project.updated ",
    topic: " projects ",
    workspace: {
      id: "11",
      slug: " acme "
    },
    entityType: " project ",
    entityId: " 42 ",
    commandId: " cmd_1 ",
    sourceClientId: " cli_1 ",
    actorUserId: "7",
    payload: null
  });

  assert.equal(typeof envelope.eventId, "string");
  assert.equal(envelope.eventId.startsWith("evt_"), true);
  assert.equal(typeof envelope.occurredAt, "string");
  assert.equal(envelope.eventType, "workspace.project.updated");
  assert.equal(envelope.topic, "projects");
  assert.equal(envelope.workspaceId, 11);
  assert.equal(envelope.workspaceSlug, "acme");
  assert.equal(envelope.entityType, "project");
  assert.equal(envelope.entityId, "42");
  assert.equal(envelope.commandId, "cmd_1");
  assert.equal(envelope.sourceClientId, "cli_1");
  assert.equal(envelope.actorUserId, 7);
  assert.deepEqual(envelope.payload, {});
});

test("realtime envelope helpers clone payload objects instead of mutating input", () => {
  const basePayload = {
    projectId: 42
  };
  const chatPayload = {
    threadId: 9
  };

  const baseEnvelope = createRealtimeEventEnvelope({
    eventType: "workspace.project.updated",
    topic: "projects",
    entityType: "project",
    entityId: 42,
    payload: basePayload
  });
  const chatEnvelope = createTargetedChatEventEnvelope({
    eventType: "chat.message.created",
    topic: "chat",
    threadId: 9,
    scopeKind: "workspace",
    workspaceId: 11,
    actorUserId: 7,
    targetUserIds: [7, "8", 0, 7],
    payload: chatPayload
  });

  basePayload.projectId = 99;
  chatPayload.threadId = 999;

  assert.deepEqual(baseEnvelope.payload, {
    projectId: 42
  });
  assert.deepEqual(chatEnvelope.payload, {
    threadId: 9
  });
  assert.equal(chatEnvelope.threadId, "9");
  assert.equal(chatEnvelope.scopeKind, "workspace");
  assert.equal(chatEnvelope.workspaceId, "11");
  assert.equal(chatEnvelope.actorUserId, "7");
  assert.deepEqual(chatEnvelope.targetUserIds, [7, 8]);
});
