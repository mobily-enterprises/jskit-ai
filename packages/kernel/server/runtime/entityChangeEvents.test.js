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
        workspaceOwnerId: 23
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
  assert.deepEqual(payload?.scope, { kind: "workspace", id: 23 });
  assert.equal(payload?.actorId, 17);
  assert.equal(payload?.commandId, "cmd-1");
  assert.equal(payload?.sourceClientId, "client-a");
  assert.equal(payload?.meta?.service?.token, "crud.customers");
  assert.equal(payload?.meta?.service?.method, "createRecord");
  assert.equal(published.length, 1);
});

test("entity change publisher infers workspace scope from service context when visibility owner ids are missing", async () => {
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
        workspace: { id: 23 },
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
