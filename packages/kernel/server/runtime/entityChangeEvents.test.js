import assert from "node:assert/strict";
import test from "node:test";
import { createEntityChangePublisher } from "./entityChangeEvents.js";

test("entity change publisher emits normalized event payload", async () => {
  const published = [];
  const publishEntityChange = createEntityChangePublisher({
    domainEvents: {
      async publish(payload) {
        published.push(payload);
      }
    },
    source: "crud",
    entity: "record"
  });

  const payload = await publishEntityChange("created", 5, {
    context: {
      actor: { id: 17 },
      requestMeta: {
        commandId: "cmd-1",
        sourceClientId: "client-a"
      },
      visibilityContext: {
        scopeOwnerId: 23
      }
    }
  }, {
    service: {
      token: "crud.customers",
      method: "createRecord"
    }
  });

  assert.equal(payload?.operation, "created");
  assert.equal(payload?.entityId, 5);
  assert.deepEqual(payload?.scope, { kind: "scope", id: 23 });
  assert.equal(payload?.actorId, 17);
  assert.equal(payload?.commandId, "cmd-1");
  assert.equal(payload?.sourceClientId, "client-a");
  assert.equal(payload?.meta?.service?.token, "crud.customers");
  assert.equal(payload?.meta?.service?.method, "createRecord");
  assert.equal(published.length, 1);
});

test("entity change publisher accepts opaque entity identifiers", async () => {
  const published = [];
  const publishEntityChange = createEntityChangePublisher({
    domainEvents: {
      async publish(payload) {
        published.push(payload);
      }
    },
    source: "crud",
    entity: "record"
  });

  const payload = await publishEntityChange("updated", "record_4f5d2f6a-607e-4b4b-9bfa-4f8c2b1d3c8e");

  assert.equal(payload?.entityId, "record_4f5d2f6a-607e-4b4b-9bfa-4f8c2b1d3c8e");
  assert.equal(published.length, 1);
});

test("entity change publisher ignores missing entity identifiers", async () => {
  const published = [];
  const publishEntityChange = createEntityChangePublisher({
    domainEvents: {
      async publish(payload) {
        published.push(payload);
      }
    },
    source: "crud",
    entity: "record"
  });

  const payload = await publishEntityChange("updated", null);

  assert.equal(payload, null);
  assert.equal(published.length, 0);
});

test("entity change publisher infers scoped owner from service context when visibility owner ids are missing", async () => {
  const published = [];
  const publishEntityChange = createEntityChangePublisher({
    domainEvents: {
      async publish(payload) {
        published.push(payload);
      }
    },
    source: "workspace",
    entity: "settings"
  });

  const payload = await publishEntityChange(
    "updated",
    11,
    {
      context: {
        actor: { id: 17 },
        scope: { kind: "workspace", id: 23 },
        visibilityContext: {
          visibility: "workspace"
        }
      }
    },
    {
      service: {
        token: "users.workspace.settings.service",
        method: "updateWorkspaceSettings"
      }
    }
  );

  assert.deepEqual(payload?.scope, { kind: "workspace", id: 23 });
  assert.equal(published.length, 1);
});

test("entity change publisher supports opaque actor and scope identifiers", async () => {
  const published = [];
  const publishEntityChange = createEntityChangePublisher({
    domainEvents: {
      async publish(payload) {
        published.push(payload);
      }
    },
    source: "workspace",
    entity: "settings"
  });

  const payload = await publishEntityChange("updated", 11, {
    context: {
      actor: { id: "user_17" },
      visibilityContext: {
        scopeKind: "workspace_user",
        scopeOwnerId: "workspace_23",
        userOwnerId: "user_17",
        requiresActorScope: true
      }
    }
  });

  assert.deepEqual(payload?.scope, {
    kind: "workspace_user",
    id: "workspace_23",
    scopeId: "workspace_23",
    userId: "user_17"
  });
  assert.equal(payload?.actorId, "user_17");
  assert.equal(published.length, 1);
});

test("entity change publisher does not infer actor-scoped ownership from actor.id", async () => {
  const published = [];
  const publishEntityChange = createEntityChangePublisher({
    domainEvents: {
      async publish(payload) {
        published.push(payload);
      }
    },
    source: "workspace",
    entity: "settings"
  });

  const payload = await publishEntityChange("updated", 11, {
    context: {
      actor: { id: "user_17" },
      visibilityContext: {
        scopeKind: "workspace_user",
        scopeOwnerId: "workspace_23",
        requiresActorScope: true
      }
    }
  });

  assert.deepEqual(payload?.scope, {
    kind: "global",
    id: null
  });
  assert.equal(payload?.actorId, "user_17");
  assert.equal(published.length, 1);
});

test("entity change publisher does not infer actor scope from scope kind suffix", async () => {
  const published = [];
  const publishEntityChange = createEntityChangePublisher({
    domainEvents: {
      async publish(payload) {
        published.push(payload);
      }
    },
    source: "workspace",
    entity: "settings"
  });

  const payload = await publishEntityChange("updated", 11, {
    context: {
      visibilityContext: {
        scopeKind: "workspace_user",
        scopeOwnerId: "workspace_23",
        requiresActorScope: false
      }
    }
  });

  assert.deepEqual(payload?.scope, {
    kind: "workspace_user",
    id: "workspace_23"
  });
  assert.equal(payload?.actorId, null);
  assert.equal(published.length, 1);
});
