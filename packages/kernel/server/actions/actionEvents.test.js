import assert from "node:assert/strict";
import test from "node:test";
import { createEntityChangedActionEvent } from "./actionEvents.js";

function buildEvent(context, { entityId = 11, realtime = null } = {}) {
  return createEntityChangedActionEvent({
    source: "workspace",
    entity: "settings",
    operation: "updated",
    entityId,
    realtime
  })({ context });
}

test("entity-changed action events carry actor, command and source client", () => {
  const event = buildEvent({
    actor: { id: 17 },
    requestMeta: { idempotencyKey: "cmd-1", sourceClientId: "client-a" },
    visibilityContext: { scopeOwnerId: 23 }
  }, {
    entityId: 5,
    realtime: { event: "settings.changed", payload: { reason: "edit" } }
  });

  assert.equal(event.type, "entity.changed");
  assert.equal(event.entityId, "5");
  assert.deepEqual(event.scope, { kind: "scope", id: "23" });
  assert.equal(event.actorId, "17");
  assert.equal(event.commandId, "cmd-1");
  assert.equal(event.sourceClientId, "client-a");
  assert.deepEqual(event.realtime, { event: "settings.changed", audience: "event_scope", payload: { reason: "edit" } });
});

test("entity-changed action events skip missing entity identifiers", () => {
  assert.equal(buildEvent({}, { entityId: null }), null);
});

test("entity-changed action events fall back to the context scope when visibility has no owner", () => {
  const event = buildEvent({
    scope: { kind: "workspace", id: 23 },
    visibilityContext: { visibility: "workspace" }
  });

  assert.deepEqual(event.scope, { kind: "workspace", id: "23" });
});

test("entity-changed action events keep actor-scoped ownership only with an explicit user", () => {
  assert.deepEqual(buildEvent({
    actor: { id: "user_17" },
    visibilityContext: {
      scopeKind: "workspace_user",
      scopeOwnerId: "workspace_23",
      userId: "user_17",
      requiresActorScope: true
    }
  }).scope, {
    kind: "workspace_user",
    id: "workspace_23",
    scopeId: "workspace_23",
    userId: "user_17"
  });

  assert.deepEqual(buildEvent({
    actor: { id: "user_17" },
    visibilityContext: {
      scopeKind: "workspace_user",
      scopeOwnerId: "workspace_23",
      requiresActorScope: true
    }
  }).scope, { kind: "global", id: null });

  assert.deepEqual(buildEvent({
    visibilityContext: {
      scopeKind: "workspace_user",
      scopeOwnerId: "workspace_23",
      requiresActorScope: false
    }
  }).scope, { kind: "workspace_user", id: "workspace_23" });
});
