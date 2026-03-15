import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/service.js";

test("crudService delegates CRUD operations to the repository", async () => {
  const calls = [];
  const crudRepository = {
    async list(query) {
      calls.push(["list", query]);
      return { items: [], nextCursor: null };
    },
    async findById(recordId) {
      calls.push(["findById", recordId]);
      return { id: recordId, name: "Ada", surname: "Lovelace" };
    },
    async create(payload) {
      calls.push(["create", payload]);
      return { id: 1, ...payload };
    },
    async updateById(recordId, payload) {
      calls.push(["updateById", recordId, payload]);
      return { id: recordId, ...payload };
    },
    async deleteById(recordId) {
      calls.push(["deleteById", recordId]);
      return { id: recordId, deleted: true };
    }
  };

  const service = createService({ crudRepository });

  const options = {};
  await service.listRecords({ limit: 10 }, options);
  await service.getRecord(3, options);
  await service.createRecord({ name: "Ada", surname: "Lovelace" }, options);
  await service.updateRecord(4, { surname: "Byron" }, options);
  await service.deleteRecord(5, options);

  assert.deepEqual(calls, [
    ["list", { limit: 10 }],
    ["findById", 3],
    ["create", { name: "Ada", surname: "Lovelace" }],
    ["updateById", 4, { surname: "Byron" }],
    ["deleteById", 5]
  ]);
});

test("crudService throws 404 when a record is missing", async () => {
  const service = createService({
    crudRepository: {
      async list() {
        return { items: [], nextCursor: null };
      },
      async findById() {
        return null;
      },
      async create(payload) {
        return { id: 1, ...payload };
      },
      async updateById() {
        return null;
      },
      async deleteById() {
        return null;
      }
    }
  });

  await assert.rejects(
    () => service.getRecord(9, {}),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );

  await assert.rejects(
    () => service.updateRecord(9, { name: "Ada" }, {}),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );

  await assert.rejects(
    () => service.deleteRecord(9, {}),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );
});
