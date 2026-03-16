import assert from "node:assert/strict";
import test from "node:test";
import { createContainer } from "../container/lib/container.js";
import { installServiceRegistrationApi } from "./serviceRegistration.js";
import { createServiceSchemaCatalog } from "./schemaCatalog.js";

test("createServiceSchemaCatalog returns no entries without schema registry registrations", () => {
  const app = createContainer();
  app.singleton("domainEvents", () => ({
    async publish() {
      return null;
    }
  }));
  installServiceRegistrationApi(app);

  app.service(
    "demo.customers.service",
    () => ({
      createRecord(payload = {}) {
        return {
          id: payload?.id || 1
        };
      }
    })
  );

  const catalog = createServiceSchemaCatalog(app);
  const schemaEntry = catalog.getServiceMethodSchema("demo.customers.service", "createRecord");
  assert.equal(schemaEntry, null);

  const entries = catalog.listServiceMethodSchemas();
  assert.equal(entries.length, 0);
});
