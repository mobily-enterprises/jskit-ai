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
    requestMeta: { commandId: "cmd-1", sourceClientId: "client-a" },
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

test("entity-changed action events read the request's user when the context has no actor", () => {
  const event = buildEvent({ requestMeta: { request: { user: { id: 31 } } } });

  assert.equal(event.actorId, "31");
});

test("an entity-changed event builder carries the realtime part it was declared with", () => {
  const audience = Object.freeze({ preset: "event_scope" });
  const realtime = { event: "workspace.settings.changed", audience };
  assert.equal(createEntityChangedActionEvent({ source: "workspace", entity: "settings", operation: "updated", entityId: 1, realtime }).realtime,
    realtime);
  assert.equal(createEntityChangedActionEvent({ source: "workspace", entity: "settings", operation: "updated", entityId: 1 }).realtime, null);
});

test("a global event scope carries the workspace the request resolved, and never one its input or payload names", () => {
  const realtime = { event: "bookings.changed", payload: ({ input }) => ({ workspaceId: input.workspaceId }) };
  const build = (context) => createEntityChangedActionEvent({ source: "portal", entity: "booking", operation: "updated", entityId: 5, realtime })({
    context,
    input: { workspaceId: "99" }
  });
  const resolved = { workspace: { id: 23 }, requestMeta: { resolvedWorkspaceContext: { workspace: { id: "23" } } } };
  assert.deepEqual(build({ ...resolved, visibilityContext: { visibility: "public" } }).scope, { kind: "global", id: null, workspaceId: "23" });
  assert.deepEqual(build({ requestMeta: { request: { workspace: { id: 23 } } } }).scope, { kind: "global", id: null, workspaceId: "23" });
  assert.deepEqual(build({}).scope, { kind: "global", id: null });
  // Two workspaces in one context name none.
  assert.deepEqual(build({ workspace: { id: 23 }, requestMeta: { resolvedWorkspaceContext: { workspace: { id: 24 } } } }).scope,
    { kind: "global", id: null });
  // A scope that names its own workspace or user keeps it.
  assert.deepEqual(build({ ...resolved, visibilityContext: { scopeKind: "workspace", scopeOwnerId: 23 } }).scope, { kind: "workspace", id: "23" });
});
