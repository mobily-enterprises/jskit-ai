import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createTemplateServerFixture } from "../test-support/templateServerFixture.js";

const fixture = await createTemplateServerFixture();
const { createService } = await fixture.importServerModule("service.js");

after(async () => {
  await fixture.cleanup();
});

test("crudService delegates CRUD operations to the repository", async () => {
  const calls = [];
  const customersRepository = {
    async list(query) {
      calls.push(["list", query]);
      return { items: [], nextCursor: null };
    },
    async findById(recordId) {
      calls.push(["findById", recordId]);
      return { id: recordId, textField: "Example", dateField: "2026-03-11T00:00:00.000Z", numberField: 3 };
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

  const service = createService({ customersRepository });

  const options = {};
  await service.listRecords({ limit: 10 }, options);
  await service.getRecord(3, options);
  await service.createRecord({ textField: "Example", dateField: "2026-03-11", numberField: 3 }, options);
  await service.updateRecord(4, { textField: "Changed" }, options);
  await service.deleteRecord(5, options);

  assert.deepEqual(calls, [
    ["list", { limit: 10 }],
    ["findById", 3],
    ["create", { textField: "Example", dateField: "2026-03-11", numberField: 3 }],
    ["findById", 4],
    ["updateById", 4, { textField: "Changed" }],
    ["deleteById", 5]
  ]);
});

test("crudService throws 404 when a record is missing", async () => {
  const service = createService({
    customersRepository: {
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
    () => service.updateRecord(9, { textField: "Changed" }, {}),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );

  await assert.rejects(
    () => service.deleteRecord(9, {}),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );
});

test("crudService passes existing records into repository update options via the shared CRUD service", async () => {
  const calls = [];
  const service = createService({
    customersRepository: {
      async list() {
        return { items: [], nextCursor: null };
      },
      async findById(recordId) {
        calls.push(["findById", recordId]);
        return {
          id: recordId,
          textField: "Existing",
          dateField: "2026-03-11T00:00:00.000Z",
          numberField: 3
        };
      },
      async create(payload) {
        return { id: 1, ...payload };
      },
      async updateById(recordId, payload, options = {}) {
        calls.push(["updateById", recordId, payload, options]);
        return {
          id: recordId,
          textField: payload.textField || "",
          dateField: "2026-03-11T00:00:00.000Z",
          numberField: payload.numberField ?? 0
        };
      },
      async deleteById(recordId) {
        return { id: recordId, deleted: true };
      }
    }
  });

  await service.updateRecord(4, { textField: "Changed" }, {});

  assert.deepEqual(calls, [
    ["findById", 4],
    ["updateById", 4, { textField: "Changed" }, {
      existingRecord: {
        id: 4,
        textField: "Existing",
        dateField: "2026-03-11T00:00:00.000Z",
        numberField: 3
      }
    }]
  ]);
});

test("crudService supports optional fieldAccess hooks for writable filtering", async () => {
  const calls = [];
  const service = createService({
    customersRepository: {
      async list() {
        return {
          items: [
            {
              id: 1,
              textField: "A",
              dateField: "2026-03-11T00:00:00.000Z",
              numberField: 1
            }
          ],
          nextCursor: null
        };
      },
      async findById() {
        return {
          id: 1,
          textField: "A",
          dateField: "2026-03-11T00:00:00.000Z",
          numberField: 1
        };
      },
      async create(payload) {
        calls.push(payload);
        return {
          id: 1,
          textField: payload.textField || "",
          dateField: "2026-03-11T00:00:00.000Z",
          numberField: payload.numberField ?? 0
        };
      },
      async updateById(recordId, payload) {
        calls.push([recordId, payload]);
        return {
          id: recordId,
          textField: payload.textField || "",
          dateField: "2026-03-11T00:00:00.000Z",
          numberField: payload.numberField ?? 0
        };
      },
      async deleteById(recordId) {
        return { id: recordId, deleted: true };
      }
    },
    fieldAccess: {
      writable: () => ["textField"],
      writeMode: "strip"
    }
  });

  await service.createRecord(
    {
      textField: "Allowed",
      numberField: 99
    },
    {}
  );
  await service.updateRecord(
    2,
    {
      textField: "Updated",
      numberField: 88
    },
    {}
  );

  assert.deepEqual(calls, [
    { textField: "Allowed" },
    [2, { textField: "Updated" }]
  ]);
});
