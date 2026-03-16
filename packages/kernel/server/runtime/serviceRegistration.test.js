import assert from "node:assert/strict";
import test from "node:test";
import { createContainer } from "../container/lib/container.js";
import { getServicePermissions } from "./serviceAuthorization.js";
import {
  installServiceRegistrationApi,
  resolveServiceRegistrations
} from "./serviceRegistration.js";

test("installServiceRegistrationApi exposes app.service and default require:none", async () => {
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
        workspaceOwnerId: 13
      }
    }
  });

  assert.equal(result.id, 41);
  assert.equal(getServicePermissions(service).createRecord.require, "none");
  assert.equal(service.serviceEvents.createRecord[0].realtime.audience, "all_workspace_users");
  assert.equal(published.length, 1);
  assert.equal(published[0].source, "crud");
  assert.equal(published[0].operation, "created");
  assert.equal(published[0].meta?.service?.token, "test.customers.service");
  assert.equal(published[0].meta?.service?.method, "createRecord");
  assert.equal(published[0].meta?.realtime?.event, "customers.record.changed");
});

test("app.service enforces declared permissions", () => {
  const app = createContainer();
  app.singleton("domainEvents", () => ({
    async publish() {
      return null;
    }
  }));
  installServiceRegistrationApi(app);

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
  );

  const service = app.make("test.secure.service");
  assert.throws(
    () => service.listRecords({}),
    (error) => error?.status === 401 && error?.message === "Authentication required."
  );
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
    }),
    {
      permissions: {
        createRecord: {
          require: "authenticated"
        }
      }
    }
  );

  const entries = resolveServiceRegistrations(app);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].serviceToken, "test.registry.service");
  assert.equal(entries[0].metadata.permissions.createRecord.require, "authenticated");
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

test("app.service preserves declared method schemas and exposes them on materialized service", async () => {
  const app = createContainer();
  app.singleton("domainEvents", () => ({
    async publish() {
      return null;
    }
  }));
  installServiceRegistrationApi(app);

  const inputSchema = Object.freeze({
    type: "object",
    properties: {
      value: {
        type: "string"
      }
    },
    required: ["value"],
    additionalProperties: false
  });
  const outputSchema = Object.freeze({
    type: "object",
    properties: {
      ok: {
        type: "boolean"
      }
    },
    required: ["ok"],
    additionalProperties: false
  });

  app.service(
    "test.schema.service",
    () => ({
      async mutate(payload = {}) {
        return {
          ok: Boolean(payload?.value)
        };
      }
    }),
    {
      schemas: {
        mutate: {
          description: "Mutate value.",
          input: {
            schema: inputSchema
          },
          output: {
            schema: outputSchema
          }
        }
      }
    }
  );

  const registrations = resolveServiceRegistrations(app);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].metadata.schemas.mutate.input.schema, inputSchema);
  assert.equal(registrations[0].metadata.schemas.mutate.output.schema, outputSchema);

  const service = app.make("test.schema.service");
  assert.equal(service.serviceSchemas.mutate.input.schema, inputSchema);
  assert.equal(service.serviceSchemas.mutate.output.schema, outputSchema);
});
