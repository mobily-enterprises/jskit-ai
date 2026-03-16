import assert from "node:assert/strict";
import test from "node:test";
import { createContainer } from "../container/lib/container.js";
import { installServiceRegistrationApi } from "./serviceRegistration.js";
import { createServiceSchemaCatalog } from "./schemaCatalog.js";

test("createServiceSchemaCatalog resolves declared method schemas by service token + method", () => {
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
      name: {
        type: "string"
      }
    },
    required: ["name"],
    additionalProperties: false
  });
  const outputSchema = Object.freeze({
    type: "object",
    properties: {
      id: {
        type: "integer",
        minimum: 1
      }
    },
    required: ["id"],
    additionalProperties: false
  });

  app.service(
    "demo.customers.service",
    () => ({
      createRecord(payload = {}) {
        return {
          id: payload?.id || 1
        };
      }
    }),
    {
      schemas: {
        createRecord: {
          description: "Create customer.",
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

  const catalog = createServiceSchemaCatalog(app);
  const schemaEntry = catalog.getServiceMethodSchema("demo.customers.service", "createRecord");
  assert.ok(schemaEntry);
  assert.equal(schemaEntry.description, "Create customer.");
  assert.equal(schemaEntry.inputSchema, inputSchema);
  assert.equal(schemaEntry.outputSchema, outputSchema);

  const entries = catalog.listServiceMethodSchemas();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "demo.customers.service.createRecord");
});

