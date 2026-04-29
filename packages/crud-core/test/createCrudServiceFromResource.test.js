import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import { createCrudServiceFromResource } from "../src/server/createCrudServiceFromResource.js";

function createOperationSchemaDefinition(structure = {}, mode = "replace") {
  return {
    schema: createSchema(structure),
    mode
  };
}

function createResourceWithOutputSchema(overrides = {}) {
  return {
    namespace: "contacts",
    operations: {
      view: {
        output: createOperationSchemaDefinition({
          id: { type: "integer", required: true },
          name: { type: "string", required: true },
          optionalSecret: { type: "string", required: false },
          nullableSecret: {
            type: "string",
            required: true,
            nullable: true
          },
          defaultedSecret: {
            type: "string",
            required: true,
            default: ""
          }
        })
      }
    },
    ...overrides
  };
}

function createRepositoryDouble(overrides = {}) {
  return {
    async list(query) {
      return { items: [query], nextCursor: null };
    },
    async findById(recordId) {
      return recordId === 1 ? { id: 1 } : null;
    },
    async create(payload) {
      return { id: 2, ...payload };
    },
    async updateById(recordId, payload) {
      if (recordId !== 1) {
        return null;
      }
      return { id: 1, ...payload };
    },
    async deleteById(recordId) {
      if (recordId !== 1) {
        return null;
      }
      return { id: 1, deleted: true };
    },
    ...overrides
  };
}

test("createCrudServiceFromResource builds default service events", () => {
  const { baseServiceEvents } = createCrudServiceFromResource({
    namespace: "contacts"
  });

  assert.equal(baseServiceEvents.createRecord[0].realtime.event, "contacts.record.changed");
  assert.equal(baseServiceEvents.updateRecord[0].realtime.event, "contacts.record.changed");
  assert.equal(baseServiceEvents.deleteRecord[0].realtime.event, "contacts.record.changed");
});

test("createCrudServiceFromResource normalizes namespace for realtime event names", () => {
  const { baseServiceEvents } = createCrudServiceFromResource({
    namespace: "customer-orders"
  });

  assert.equal(baseServiceEvents.createRecord[0].realtime.event, "customer_orders.record.changed");
});

test("createCrudServiceFromResource delegates service methods and applies 404 semantics", async () => {
  const { createBaseService } = createCrudServiceFromResource({
    namespace: "contacts"
  });
  const service = createBaseService({
    repository: createRepositoryDouble()
  });

  const list = await service.listRecords({ limit: 2 }, {});
  assert.deepEqual(list, {
    items: [{ limit: 2 }],
    nextCursor: null
  });
  assert.deepEqual(await service.getRecord(1, {}), { id: 1 });
  await assert.rejects(
    () => service.getRecord(9, {}),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );
  assert.deepEqual(await service.createRecord({ name: "A" }, {}), { id: 2, name: "A" });
  assert.deepEqual(await service.updateRecord(1, { name: "B" }, {}), { id: 1, name: "B" });
  await assert.rejects(
    () => service.updateRecord(9, { name: "B" }, {}),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );
  assert.deepEqual(await service.deleteRecord(1, {}), { id: 1, deleted: true });
  await assert.rejects(
    () => service.deleteRecord(9, {}),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );
});

test("createCrudServiceFromResource forwards list include as repository call option", async () => {
  const listCalls = [];
  const { createBaseService } = createCrudServiceFromResource({
    namespace: "contacts"
  });
  const service = createBaseService({
    repository: createRepositoryDouble({
      async list(query = {}, options = {}) {
        listCalls.push({
          query,
          options
        });
        return {
          items: [],
          nextCursor: null
        };
      }
    })
  });

  await service.listRecords({
    q: "tony",
    include: "primaryVetId"
  }, {
    visibilityContext: {
      visibility: "workspace"
    }
  });

  assert.deepEqual(listCalls[0], {
    query: {
      q: "tony"
    },
    options: {
      visibilityContext: {
        visibility: "workspace"
      },
      include: "primaryVetId"
    }
  });
});

test("createCrudServiceFromResource passes existing records to repository update options", async () => {
  const updateCalls = [];
  const { createBaseService } = createCrudServiceFromResource({
    namespace: "contacts"
  });

  const service = createBaseService({
    repository: createRepositoryDouble({
      async findById(recordId) {
        return recordId === 1
          ? { id: 1, name: "Existing" }
          : null;
      },
      async updateById(recordId, payload, options = {}) {
        updateCalls.push({ recordId, payload, options });
        return { id: 1, ...payload };
      }
    })
  });

  const record = await service.updateRecord(1, { name: "B" }, {});

  assert.deepEqual(updateCalls, [
    {
      recordId: 1,
      payload: { name: "B" },
      options: {
        existingRecord: { id: 1, name: "Existing" }
      }
    }
  ]);
  assert.deepEqual(record, { id: 1, name: "B" });
});

test("createCrudServiceFromResource validates required inputs", async () => {
  assert.throws(
    () => createCrudServiceFromResource({}),
    /resource\.namespace/
  );

  const { createBaseService } = createCrudServiceFromResource({
    namespace: "contacts"
  });

  assert.throws(
    () => createBaseService({}),
    /requires repository/
  );

  const service = createBaseService({
    repository: createRepositoryDouble({
      async create() {
        return null;
      }
    })
  });
  await assert.rejects(
    () => service.createRecord({}, {}),
    /contactsService could not load the created record/
  );
});

test("createCrudServiceFromResource readable field hooks require view output schema", async () => {
  const { createBaseService } = createCrudServiceFromResource({
    namespace: "contacts"
  });

  const service = createBaseService({
    repository: createRepositoryDouble(),
    fieldAccess: {
      readable: () => ["id"]
    }
  });

  await assert.rejects(
    () => service.getRecord(1, {}),
    /requires resource\.operations\.view\.output for fieldAccess\.readable/
  );
});

test("createCrudServiceFromResource enforces writable field access hooks", async () => {
  const createCalls = [];
  const { createBaseService } = createCrudServiceFromResource(createResourceWithOutputSchema());

  const service = createBaseService({
    repository: createRepositoryDouble({
      async create(payload) {
        createCalls.push(payload);
        return { id: 2, ...payload };
      }
    }),
    fieldAccess: {
      writable: () => ["name"]
    }
  });

  await assert.rejects(
    () => service.createRecord({ name: "A", optionalSecret: "hidden" }, {}),
    (error) => error?.status === 403 && /Write access denied for fields: optionalSecret/.test(error?.message || "")
  );
  assert.equal(createCalls.length, 0);
});

test("createCrudServiceFromResource supports writable field strip mode", async () => {
  const createCalls = [];
  const { createBaseService } = createCrudServiceFromResource(createResourceWithOutputSchema());

  const service = createBaseService({
    repository: createRepositoryDouble({
      async create(payload) {
        createCalls.push(payload);
        return { id: 2, ...payload, nullableSecret: "x", defaultedSecret: "y" };
      }
    }),
    fieldAccess: {
      writable: () => ["name"],
      writeMode: "strip"
    }
  });

  await service.createRecord({ name: "A", optionalSecret: "hidden" }, {});
  assert.deepEqual(createCalls, [{ name: "A" }]);
});

test("createCrudServiceFromResource applies readable field access hooks with drop/null/default redaction", async () => {
  const { createBaseService } = createCrudServiceFromResource(createResourceWithOutputSchema());

  const service = createBaseService({
    repository: createRepositoryDouble({
      async findById() {
        return {
          id: 1,
          name: "A",
          optionalSecret: "drop-me",
          nullableSecret: "redact-to-null",
          defaultedSecret: "redact-to-default"
        };
      }
    }),
    fieldAccess: {
      readable: () => ["id", "name"]
    }
  });

  const record = await service.getRecord(1, {});
  assert.deepEqual(record, {
    id: 1,
    name: "A",
    nullableSecret: null,
    defaultedSecret: ""
  });
});

test("createCrudServiceFromResource readable filtering fails fast for required non-nullable fields without defaults", async () => {
  const { createBaseService } = createCrudServiceFromResource({
    namespace: "contacts",
    operations: {
      view: {
        output: {
          schema: createSchema({
            id: { type: "integer", required: true },
            strictSecret: { type: "string", required: true }
          }),
          mode: "replace"
        }
      }
    }
  });

  const service = createBaseService({
    repository: createRepositoryDouble({
      async findById() {
        return { id: 1, strictSecret: "value" };
      }
    }),
    fieldAccess: {
      readable: () => ["id"]
    }
  });

  await assert.rejects(
    () => service.getRecord(1, {}),
    /cannot redact required non-nullable field "strictSecret" without a default value/
  );
});
