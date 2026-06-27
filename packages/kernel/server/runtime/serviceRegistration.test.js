import assert from "node:assert/strict";
import test from "node:test";
import { createContainer } from "../container/index.js";
import {
  installServiceRegistrationApi,
  resolveServiceRegistrations
} from "../registries/serviceRegistrationRegistry.js";

test("installServiceRegistrationApi exposes app.service and publishes declared events", async () => {
  const app = createContainer();
  const published = [];
  app.singleton("domainEvents", () => ({
    async publish(payload) {
      published.push(payload);
      return null;
    }
  }));

  installServiceRegistrationApi(app);
  assert.equal(typeof app.service, "function");

  app.service(
    "test.customers.service",
    () => ({
      async createRecord() {
        return { id: 41 };
      }
    }),
    {
      events: {
        createRecord: [
          {
            type: "entity.changed",
            source: "crud",
            entity: "record",
            operation: "created",
            realtime: {
              event: "customers.record.changed"
            }
          }
        ]
      }
    }
  );

  const service = app.make("test.customers.service");
  const result = await service.createRecord({
    context: {
      actor: { id: 7 },
      visibilityContext: {
        scopeOwnerId: 13
      }
    }
  });

  assert.equal(result.id, 41);
  assert.equal(service.serviceEvents.createRecord[0].realtime.audience, "event_scope");
  assert.equal(published.length, 1);
  assert.equal(published[0].source, "crud");
  assert.equal(published[0].operation, "created");
  assert.equal(published[0].meta?.service?.token, "test.customers.service");
  assert.equal(published[0].meta?.service?.method, "createRecord");
  assert.equal(published[0].meta?.realtime?.event, "customers.record.changed");
});

test("app.service rejects deprecated permissions metadata", () => {
  const app = createContainer();
  app.singleton("domainEvents", () => ({
    async publish() {
      return null;
    }
  }));
  installServiceRegistrationApi(app);

  assert.throws(
    () =>
      app.service(
        "test.secure.service",
        () => ({
          async listRecords() {
            return [];
          }
        }),
        {
          permissions: {
            listRecords: {
              require: "authenticated"
            }
          }
        }
      ),
    /metadata\.permissions is no longer supported/
  );
});

test("app.service publishes lifecycle action, reason, and realtime payload metadata", async () => {
  const app = createContainer();
  const published = [];
  app.singleton("domainEvents", () => ({
    async publish(payload) {
      published.push(payload);
      return null;
    }
  }));
  installServiceRegistrationApi(app);

  app.service(
    "test.projects.service",
    () => ({
      async closeRuntime() {
        return {
          id: "project_acme",
          action: "runtime-closed",
          message: "Project is closed."
        };
      }
    }),
    {
      events: {
        closeRuntime: [
          {
            type: "entity.changed",
            source: "vibe64",
            entity: "project",
            operation: "updated",
            action: ({ result }) => result?.action,
            reason: "user-request",
            realtime: {
              event: "vibe64.project.changed",
              payload: ({ result }) => ({
                message: result?.message || ""
              })
            }
          }
        ]
      }
    }
  );

  const service = app.make("test.projects.service");
  await service.closeRuntime();

  assert.equal(service.serviceEvents.closeRuntime[0].reason, "user-request");
  assert.equal(typeof service.serviceEvents.closeRuntime[0].action, "function");
  assert.equal(published.length, 1);
  assert.equal(published[0].meta?.action, "runtime-closed");
  assert.equal(published[0].meta?.reason, "user-request");
  assert.equal(published[0].meta?.realtime?.event, "vibe64.project.changed");
  assert.deepEqual(published[0].meta?.realtime?.payload, {
    message: "Project is closed."
  });
});

test("resolveServiceRegistrations returns declared service metadata", () => {
  const app = createContainer();
  app.singleton("domainEvents", () => ({
    async publish() {
      return null;
    }
  }));
  installServiceRegistrationApi(app);

  app.service(
    "test.registry.service",
    () => ({
      async createRecord() {
        return { id: 1 };
      }
    })
  );

  const entries = resolveServiceRegistrations(app);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].serviceToken, "test.registry.service");
  assert.deepEqual(entries[0].metadata, {
    events: {}
  });
});

test("app.service keeps realtime audience callbacks", () => {
  const app = createContainer();
  app.singleton("domainEvents", () => ({
    async publish() {
      return null;
    }
  }));
  installServiceRegistrationApi(app);

  const audience = () => ({ userId: 7 });
  app.service(
    "test.audience.service",
    () => ({
      async updateRecord() {
        return { id: 2 };
      }
    }),
    {
      events: {
        updateRecord: [
          {
            type: "entity.changed",
            source: "crud",
            entity: "record",
            operation: "updated",
            realtime: {
              event: "customers.record.changed",
              audience
            }
          }
        ]
      }
    }
  );

  const service = app.make("test.audience.service");
  assert.equal(typeof service.serviceEvents.updateRecord[0].realtime.audience, "function");
});

test("app.service accepts opaque realtime audience string presets", () => {
  const app = createContainer();
  app.singleton("domainEvents", () => ({
    async publish() {
      return null;
    }
  }));
  installServiceRegistrationApi(app);

  app.service(
    "test.opaque.audience.service",
    () => ({
      async updateRecord() {
        return { id: 2 };
      }
    }),
    {
      events: {
        updateRecord: [
          {
            type: "entity.changed",
            source: "crud",
            entity: "record",
            operation: "updated",
            realtime: {
              event: "customers.record.changed",
              audience: "workspace_member"
            }
          }
        ]
      }
    }
  );

  const service = app.make("test.opaque.audience.service");
  assert.equal(service.serviceEvents.updateRecord[0].realtime.audience, "workspace_member");
});
