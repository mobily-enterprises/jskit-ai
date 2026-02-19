import assert from "node:assert/strict";
import test from "node:test";

import { createService, __testables } from "../server/domain/realtime/services/events.service.js";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../shared/realtime/eventTypes.js";

test("realtime events service builds normalized project event envelopes", () => {
  const service = createService();

  const envelope = service.publishProjectEvent({
    operation: "created",
    workspace: {
      id: 11,
      slug: "acme"
    },
    project: {
      id: 123
    },
    commandId: "cmd_1",
    sourceClientId: "cli_1",
    actorUserId: 7
  });

  assert.equal(typeof envelope.eventId, "string");
  assert.equal(envelope.eventType, REALTIME_EVENT_TYPES.WORKSPACE_PROJECT_CREATED);
  assert.equal(envelope.topic, REALTIME_TOPICS.PROJECTS);
  assert.equal(envelope.workspaceId, 11);
  assert.equal(envelope.workspaceSlug, "acme");
  assert.equal(envelope.entityType, "project");
  assert.equal(envelope.entityId, "123");
  assert.equal(envelope.commandId, "cmd_1");
  assert.equal(envelope.sourceClientId, "cli_1");
  assert.equal(envelope.actorUserId, 7);
  assert.equal(envelope.payload.operation, "created");
  assert.equal(envelope.payload.projectId, 123);
});

test("realtime events service normalizes optional ids and envelope values", () => {
  const service = createService();

  const envelope = service.createEventEnvelope({
    eventType: REALTIME_EVENT_TYPES.WORKSPACE_PROJECT_UPDATED,
    topic: REALTIME_TOPICS.PROJECTS,
    workspace: {
      id: "invalid",
      slug: ""
    },
    entityType: "project",
    entityId: null,
    commandId: "",
    sourceClientId: "",
    actorUserId: "bad",
    payload: null
  });

  assert.equal(envelope.workspaceId, null);
  assert.equal(envelope.workspaceSlug, null);
  assert.equal(envelope.entityId, "none");
  assert.equal(envelope.commandId, null);
  assert.equal(envelope.sourceClientId, null);
  assert.equal(envelope.actorUserId, null);
  assert.deepEqual(envelope.payload, {});

  assert.equal(__testables.normalizePositiveIntegerOrNull("12"), 12);
  assert.equal(__testables.normalizePositiveIntegerOrNull("x"), null);
  assert.equal(__testables.normalizeStringOrNull(" acme "), "acme");
  assert.equal(__testables.normalizeStringOrNull(" "), null);
});

test("realtime events service supports publish/subscribe/unsubscribe", () => {
  const service = createService();
  const received = [];

  const unsubscribe = service.subscribe((eventEnvelope) => {
    received.push(eventEnvelope);
  });

  service.publish({ eventId: "evt-a" });
  assert.equal(received.length, 1);

  unsubscribe();
  service.publish({ eventId: "evt-b" });
  assert.equal(received.length, 1);
});

test("realtime events service isolates listener failures", () => {
  const service = createService();
  const received = [];

  service.subscribe(() => {
    throw new Error("listener failure");
  });
  service.subscribe((eventEnvelope) => {
    received.push(eventEnvelope);
  });

  service.publish({ eventId: "evt-safe" });
  assert.equal(received.length, 1);
  assert.equal(received[0].eventId, "evt-safe");
});

test("realtime events service resetForTests clears listeners", () => {
  const service = createService();
  let callCount = 0;

  service.subscribe(() => {
    callCount += 1;
  });

  service.publish({ eventId: "evt-before" });
  service.resetForTests();
  service.publish({ eventId: "evt-after" });

  assert.equal(callCount, 1);
});
