import test from "node:test";
import assert from "node:assert/strict";
import { createCrudServiceFromResource } from "../src/server/createCrudServiceFromResource.js";

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
    resource: "contacts"
  });

  assert.equal(baseServiceEvents.createRecord[0].realtime.event, "contacts.record.changed");
  assert.equal(baseServiceEvents.updateRecord[0].realtime.event, "contacts.record.changed");
  assert.equal(baseServiceEvents.deleteRecord[0].realtime.event, "contacts.record.changed");
});

test("createCrudServiceFromResource normalizes namespace for realtime event names", () => {
  const { baseServiceEvents } = createCrudServiceFromResource({
    resource: "customer-orders"
  });

  assert.equal(baseServiceEvents.createRecord[0].realtime.event, "customer_orders.record.changed");
});

test("createCrudServiceFromResource delegates service methods and applies 404 semantics", async () => {
  const { createBaseService } = createCrudServiceFromResource({
    resource: "contacts"
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

test("createCrudServiceFromResource validates required inputs", async () => {
  assert.throws(
    () => createCrudServiceFromResource({}),
    /resource\.resource/
  );

  const { createBaseService } = createCrudServiceFromResource({
    resource: "contacts"
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
