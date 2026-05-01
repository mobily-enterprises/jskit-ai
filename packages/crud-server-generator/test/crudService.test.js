import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createTemplateServerFixture } from "../test-support/templateServerFixture.js";

const fixture = await createTemplateServerFixture();
const { createService } = await fixture.importServerModule("service.js");

after(async () => {
  await fixture.cleanup();
});

test("crudService exposes the explicit JSON:API CRUD service contract", async () => {
  const calls = [];
  const customersRepository = {
    async queryDocuments(query, options) {
      calls.push(["queryDocuments", query, options]);
      return { data: [] };
    },
    async getDocumentById(recordId, options) {
      calls.push(["getDocumentById", recordId, options]);
      return { data: { id: String(recordId) } };
    },
    async createDocument(payload, options) {
      calls.push(["createDocument", payload, options]);
      return { data: { id: "1", attributes: payload } };
    },
    async patchDocumentById(recordId, payload, options) {
      calls.push(["patchDocumentById", recordId, payload, options]);
      return { data: { id: String(recordId), attributes: payload } };
    },
    async deleteDocumentById(recordId, options) {
      calls.push(["deleteDocumentById", recordId, options]);
      return null;
    }
  };

  const service = createService({ customersRepository });

  assert.deepEqual(Object.keys(service), [
    "queryDocuments",
    "getDocumentById",
    "createDocument",
    "patchDocumentById",
    "deleteDocumentById"
  ]);
  assert.equal(Object.isFrozen(service), true);

  const options = {
    trx: "trx-1",
    context: { visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } },
    include: ["workspace"]
  };
  const listResult = await service.queryDocuments({ limit: 10 }, options);
  const recordResult = await service.getDocumentById(3, options);
  const createResult = await service.createDocument({ textField: "Example", dateField: "2026-03-11", numberField: 3 }, options);
  const updateResult = await service.patchDocumentById(4, { textField: "Changed" }, options);
  const deleteResult = await service.deleteDocumentById(5, options);

  assert.deepEqual(calls, [
    ["queryDocuments", { limit: 10 }, { trx: "trx-1", context: { visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } } }],
    ["getDocumentById", 3, { trx: "trx-1", context: { visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } }, include: ["workspace"] }],
    ["createDocument", { textField: "Example", dateField: "2026-03-11", numberField: 3 }, { trx: "trx-1", context: { visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } } }],
    ["patchDocumentById", 4, { textField: "Changed" }, { trx: "trx-1", context: { visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } } }],
    ["deleteDocumentById", 5, { trx: "trx-1", context: { visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } } }]
  ]);
  assert.equal(listResult.__jskitJsonApiResult, true);
  assert.equal(listResult.kind, "document");
  assert.deepEqual(listResult.value, { data: [] });
  assert.equal(recordResult.__jskitJsonApiResult, true);
  assert.equal(recordResult.kind, "document");
  assert.deepEqual(recordResult.value, { data: { id: "3" } });
  assert.equal(createResult.__jskitJsonApiResult, true);
  assert.equal(createResult.kind, "document");
  assert.deepEqual(createResult.value, {
    data: {
      id: "1",
      attributes: {
        textField: "Example",
        dateField: "2026-03-11",
        numberField: 3
      }
    }
  });
  assert.equal(updateResult.__jskitJsonApiResult, true);
  assert.equal(updateResult.kind, "document");
  assert.deepEqual(updateResult.value, {
    data: {
      id: "4",
      attributes: {
        textField: "Changed"
      }
    }
  });
  assert.equal(deleteResult, null);
});

test("crudService throws immediately when the repository dependency is missing", () => {
  assert.throws(
    () => createService({}),
    /createService requires customersRepository\./
  );
});

test("crudService throws 404 when a document is missing", async () => {
  const service = createService({
    customersRepository: {
      async queryDocuments() {
        return { data: [] };
      },
      async getDocumentById() {
        return null;
      },
      async createDocument(payload) {
        return { data: { id: "1", attributes: payload } };
      },
      async patchDocumentById() {
        return null;
      },
      async deleteDocumentById() {
        return null;
      }
    }
  });

  await assert.rejects(
    () => service.getDocumentById(9, {}),
    (error) => error?.status === 404 && error?.message === "Document not found."
  );

  await assert.rejects(
    () => service.patchDocumentById(9, { textField: "Changed" }, {}),
    (error) => error?.status === 404 && error?.message === "Document not found."
  );
});
