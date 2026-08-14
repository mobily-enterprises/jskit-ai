import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createTemplateServerFixture } from "../test-support/templateServerFixture.js";

const fixture = await createTemplateServerFixture();
const nonWorkspaceFixture = await createTemplateServerFixture({
  surfaceRequiresWorkspace: false,
  requiresNamedPermissions: false
});
const { createActions } = await fixture.importServerModule("actions.js");
const { createRepository } = await fixture.importServerModule("repository.js");
const { createService } = await fixture.importServerModule("service.js");
const { createActions: createNonWorkspaceActions } = await nonWorkspaceFixture.importServerModule("actions.js");

after(async () => {
  await fixture.cleanup();
  await nonWorkspaceFixture.cleanup();
});

test("template createRepository passes a mutable JSKIT context into json-rest-api", async () => {
  const calls = [];
  const api = {
    resources: {
      customers: {
        async query(params, context) {
          context.method = "query";
          calls.push({ params, context });
          return { data: [] };
        }
      }
    }
  };
  const knex = {
    async transaction(work) {
      return work("trx");
    }
  };
  const sourceContext = Object.freeze({
    visibilityContext: Object.freeze({
      visibility: "workspace",
      scopeOwnerId: "7"
    })
  });

  const repository = createRepository({ api, knex });
  assert.equal(typeof repository.queryDocuments, "function");
  await repository.queryDocuments(
    {
      q: "Merc",
      cursor: "cursor_2",
      limit: 10,
      include: "workspace",
      fields: {
        customers: ["id", "name"],
        workspaces: ["id", "slug"]
      }
    },
    {
      context: sourceContext
    }
  );

  assert.deepEqual(calls[0].params, {
    queryParams: {
      filters: {
        q: "Merc"
      },
      include: ["workspace"],
      page: {
        after: "cursor_2",
        size: "10"
      },
      fields: {
        customers: "id,name",
        workspaces: "id,slug"
      }
    },
    transaction: null,
    simplified: false
  });
  assert.notEqual(
    calls[0].context,
    sourceContext
  );
  assert.deepEqual(calls[0].context, {
    method: "query",
    visibilityContext: {
      visibility: "workspace",
      scopeOwnerId: "7"
    }
  });
});

test("template createRepository builds mutable JSON:API input documents for writes", async () => {
  const calls = [];
  const api = {
    resources: {
      customers: {
        async post(params) {
          calls.push(params);
          return { data: { type: "customers", id: "1", attributes: { name: "Merc" } } };
        }
      }
    }
  };
  const knex = {
    async transaction(work) {
      return work("trx");
    }
  };

  const repository = createRepository({ api, knex });
  await repository.createDocument({ name: "Merc" }, {});

  assert.equal(Object.isFrozen(calls[0].inputRecord), false);
  assert.equal(Object.isFrozen(calls[0].inputRecord.data), false);
  assert.equal(Object.isFrozen(calls[0].inputRecord.data.attributes), false);
  assert.deepEqual(calls[0].inputRecord, {
    data: {
      type: "customers",
      attributes: {
        name: "Merc"
      }
    }
  });
});

test("template createRepository patches only the fields supplied by the caller", async () => {
  const calls = [];
  const api = {
    resources: {
      customers: {
        async patch(params) {
          calls.push(params);
          return { data: { type: "customers", id: "7", attributes: { name: "Changed" } } };
        }
      }
    }
  };
  const knex = {
    async transaction(work) {
      return work("trx");
    }
  };

  const repository = createRepository({ api, knex });
  await repository.patchDocumentById("7", { name: "Changed" }, {});

  assert.deepEqual(calls[0].inputRecord, {
    data: {
      type: "customers",
      attributes: {
        name: "Changed"
      }
    }
  });
  assert.equal(Object.hasOwn(calls[0].inputRecord.data.attributes, "updatedAt"), false);
});

test("template createRepository returns null for successful deletes", async () => {
  const calls = [];
  const api = {
    resources: {
      customers: {
        async delete(params, context) {
          calls.push({ params, context });
        }
      }
    }
  };
  const knex = {
    async transaction(work) {
      return work("trx");
    }
  };

  const repository = createRepository({ api, knex });
  const result = await repository.deleteDocumentById("7", {
    trx: "trx-1",
    context: {
      visibilityContext: {
        visibility: "workspace",
        scopeOwnerId: "7"
      }
    }
  });

  assert.equal(result, null);
  assert.deepEqual(calls[0], {
    params: {
      id: "7",
      transaction: "trx-1",
      simplified: false
    },
    context: {
      visibilityContext: {
        visibility: "workspace",
        scopeOwnerId: "7"
      }
    }
  });
});

test("template createService turns missing resource records into 404 errors", async () => {
  const service = createService({
    customersRepository: {
      async getDocumentById() {
        return null;
      },
      async patchDocumentById() {
        return null;
      }
    }
  });

  await assert.rejects(
    () => service.getDocumentById("7", {}),
    (error) => error?.status === 404 && error?.message === "Document not found."
  );
  await assert.rejects(
    () => service.patchDocumentById("7", { name: "Merc" }, {}),
    (error) => error?.status === 404 && error?.message === "Document not found."
  );
});

test("template createService returns delete results unchanged", async () => {
  const service = createService({
    customersRepository: {
      async deleteDocumentById(recordId, options) {
        return {
          recordId,
          options,
          deleted: true
        };
      }
    }
  });

  assert.deepEqual(
    await service.deleteDocumentById("7", {
      trx: "trx-1",
      context: {
        visibilityContext: {
          visibility: "workspace",
          scopeOwnerId: "7"
        }
      }
    }),
    {
      recordId: "7",
      options: {
        trx: "trx-1",
        context: {
          visibilityContext: {
            visibility: "workspace",
            scopeOwnerId: "7"
          }
        }
      },
      deleted: true
    }
  );
});

test("template createActions requires namespaced CRUD permissions by default", () => {
  const actions = createActions({ surface: "admin" });

  assert.deepEqual(
    actions.map((action) => action.permission),
    [
      { require: "all", permissions: ["crud.customers.list"] },
      { require: "all", permissions: ["crud.customers.view"] },
      { require: "all", permissions: ["crud.customers.create"] },
      { require: "all", permissions: ["crud.customers.update"] },
      { require: "all", permissions: ["crud.customers.delete"] }
    ]
  );
});

test("template list action strips workspaceSlug before calling the service", async () => {
  const actions = createActions({ surface: "admin" });
  const listAction = actions.find((action) => action.id === "crud.customers.list");
  const calls = [];

  await listAction.execute(
    {
      workspaceSlug: "acme",
      q: "Merc",
      include: "workspace",
      fields: {
        customers: ["id", "name"]
      }
    },
    { visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } },
    {
      customersService: {
        async queryDocuments(query, options) {
          calls.push({ query, options });
          return { kind: "document", value: { data: [] } };
        }
      }
    }
  );

  assert.deepEqual(calls[0].query, {
    q: "Merc",
    include: "workspace",
    fields: {
      customers: ["id", "name"]
    }
  });
  assert.deepEqual(calls[0].options, {
    context: {
      visibilityContext: {
        visibility: "workspace",
        scopeOwnerId: "7"
      }
    }
  });
});

test("template view action forwards typed fieldsets without leaking workspaceSlug", async () => {
  const actions = createActions({ surface: "admin" });
  const viewAction = actions.find((action) => action.id === "crud.customers.view");
  const calls = [];

  await viewAction.execute(
    {
      workspaceSlug: "acme",
      recordId: "7",
      include: "workspace",
      fields: {
        customers: ["id", "name"],
        workspaces: ["id", "slug"]
      }
    },
    { visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } },
    {
      customersService: {
        async getDocumentById(recordId, query, options) {
          calls.push({
            recordId,
            query,
            options
          });
          return {
            kind: "document",
            value: {
              data: {
                type: "customers",
                id: recordId
              }
            }
          };
        }
      }
    }
  );

  assert.deepEqual(calls, [{
    recordId: "7",
    query: {
      include: "workspace",
      fields: {
        customers: ["id", "name"],
        workspaces: ["id", "slug"]
      }
    },
    options: {
      context: {
        visibilityContext: {
          visibility: "workspace",
          scopeOwnerId: "7"
        }
      }
    }
  }]);
});

test("template repository returns a stable 400 for unknown sparse fields", async () => {
  const repository = createRepository({
    api: {
      resources: {
        customers: {
          async query() {
            const error = new Error(
              "Unknown sparse field 'passwordHash' requested for 'customers'"
            );
            error.code = "REST_API_FIELDSET_INVALID";
            throw error;
          }
        }
      }
    },
    knex: {
      async transaction(work) {
        return work("trx");
      }
    }
  });

  await assert.rejects(
    () => repository.queryDocuments({
      fields: {
        customers: ["passwordHash"]
      }
    }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "JSON_API_FIELDSET_INVALID");
      return true;
    }
  );
});

test("template write actions strip workspaceSlug before calling the service", async () => {
  const actions = createActions({ surface: "admin" });
  const createAction = actions.find((action) => action.id === "crud.customers.create");
  const updateAction = actions.find((action) => action.id === "crud.customers.update");
  const calls = [];

  await createAction.execute(
    {
      workspaceSlug: "acme",
      name: "Merc"
    },
    { visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } },
    {
      customersService: {
        async createDocument(payload, options) {
          calls.push({ kind: "create", payload, options });
          return { kind: "document", value: { data: { id: "1" } } };
        }
      }
    }
  );

  await updateAction.execute(
    {
      workspaceSlug: "acme",
      recordId: "7",
      name: "Changed"
    },
    { visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } },
    {
      customersService: {
        async patchDocumentById(recordId, patch, options) {
          calls.push({ kind: "update", recordId, patch, options });
          return { kind: "document", value: { data: { id: recordId } } };
        }
      }
    }
  );

  assert.deepEqual(calls, [
    {
      kind: "create",
      payload: {
        name: "Merc"
      },
      options: {
        context: {
          visibilityContext: {
            visibility: "workspace",
            scopeOwnerId: "7"
          }
        }
      }
    },
    {
      kind: "update",
      recordId: "7",
      patch: {
        name: "Changed"
      },
      options: {
        context: {
          visibilityContext: {
            visibility: "workspace",
            scopeOwnerId: "7"
          }
        }
      }
    }
  ]);
});

test("template createActions omits workspace validators for non-workspace generation", () => {
  const actions = createNonWorkspaceActions({ surface: "home" });

  assert.equal(Array.isArray(actions[0].input), false);
  assert.deepEqual(
    Object.keys(actions[0].input.schema.getFieldDefinitions()).sort(),
    ["contactId", "cursor", "fields", "include", "limit", "q"]
  );
  assert.equal(Array.isArray(actions[1].input), false);
  assert.deepEqual(
    Object.keys(actions[1].input.schema.getFieldDefinitions()).sort(),
    ["fields", "include", "recordId"]
  );
  assert.equal(Array.isArray(actions[2].input), false);
  assert.deepEqual(Object.keys(actions[2].input.schema.getFieldDefinitions()).sort(), ["contactId", "name"]);
  assert.equal(actions[2].input.mode, "create");
  assert.equal(Array.isArray(actions[3].input), false);
  assert.deepEqual(Object.keys(actions[3].input.schema.getFieldDefinitions()).sort(), ["contactId", "name", "recordId"]);
  assert.equal(Array.isArray(actions[4].input), false);
  assert.deepEqual(Object.keys(actions[4].input.schema.getFieldDefinitions()), ["recordId"]);
  assert.equal(actions[0].permission.require, "authenticated");
});
