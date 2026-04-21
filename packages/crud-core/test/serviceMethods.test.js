import test from "node:test";
import assert from "node:assert/strict";
import {
  createCrudServiceRuntime,
  crudServiceListRecords,
  crudServiceGetRecord,
  crudServiceCreateRecord,
  crudServiceUpdateRecord,
  crudServiceDeleteRecord
} from "../src/server/serviceMethods.js";

function createResourceWithOutputSchema(overrides = {}) {
  return {
    namespace: "contacts",
    operations: {
      view: {
        outputValidator: {
          schema: {
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string" }
            },
            required: ["id", "name"]
          }
        }
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
      return recordId === 1 ? { id: 1, name: "Existing" } : null;
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

test("serviceMethods expose CRUD service behavior without the factory wrapper", async () => {
  const runtime = createCrudServiceRuntime({
    namespace: "contacts"
  });
  const repository = createRepositoryDouble();

  assert.deepEqual(
    await crudServiceListRecords(runtime, repository, {}, { limit: 2 }, {}),
    { items: [{ limit: 2 }], nextCursor: null }
  );
  assert.deepEqual(await crudServiceGetRecord(runtime, repository, {}, 1, {}), { id: 1, name: "Existing" });
  assert.deepEqual(await crudServiceCreateRecord(runtime, repository, {}, { name: "A" }, {}), { id: 2, name: "A" });
  assert.deepEqual(await crudServiceUpdateRecord(runtime, repository, {}, 1, { name: "B" }, {}), { id: 1, name: "B" });
  assert.deepEqual(await crudServiceDeleteRecord(runtime, repository, {}, 1, {}), { id: 1, deleted: true });
});

test("serviceMethods pass existing record through update options and leave payload shaping to the repository/runtime", async () => {
  const runtime = createCrudServiceRuntime({
    namespace: "contacts",
    operations: {
      view: createResourceWithOutputSchema().operations.view
    }
  });
  const updateCalls = [];
  const repository = createRepositoryDouble({
    async updateById(recordId, payload, options = {}) {
      updateCalls.push({ recordId, payload, options });
      return { id: recordId, ...payload };
    }
  });

  const updated = await crudServiceUpdateRecord(runtime, repository, {}, 1, { name: "good" }, {});

  assert.deepEqual(updateCalls, [
    {
      recordId: 1,
      payload: {
        name: "good"
      },
      options: {
        existingRecord: {
          id: 1,
          name: "Existing"
        }
      }
    }
  ]);
  assert.deepEqual(updated, {
    id: 1,
    name: "good"
  });
});

test("serviceMethods enforce writable field access policies and allow readable filtering", async () => {
  const runtime = createCrudServiceRuntime(createResourceWithOutputSchema());
  const createCalls = [];
  const repository = createRepositoryDouble({
    async create(payload) {
      createCalls.push(payload);
      return { id: 2, ...payload };
    }
  });
  const fieldAccess = {
    readable: () => ["id", "name"],
    writable: () => ["name"],
    writeMode: "strip"
  };

  const created = await crudServiceCreateRecord(runtime, repository, fieldAccess, {
    name: "Allowed",
    secret: "Blocked"
  }, {});
  const viewed = await crudServiceGetRecord(runtime, repository, fieldAccess, 1, {});

  assert.deepEqual(createCalls, [{ name: "Allowed" }]);
  assert.deepEqual(created, { id: 2, name: "Allowed" });
  assert.deepEqual(viewed, { id: 1, name: "Existing" });
});
