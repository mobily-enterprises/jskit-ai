import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import {
  addResourceIfMissing,
  createJsonRestApiHost,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { createCrudJsonApiActions } from "../src/server/jsonApiModule/actions.js";
import { createCrudJsonApiRepository } from "../src/server/jsonApiModule/repository.js";
import { createCrudJsonApiService } from "../src/server/jsonApiModule/service.js";

test("assistant list traverses real SQL pages with sparse fields and capped limits", async (t) => {
  const knex = knexLib({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true
  });
  t.after(() => knex.destroy());
  await knex.schema.createTable("books", (table) => {
    table.integer("id").primary();
    table.integer("workspace_id").notNullable();
    table.string("name").notNullable();
    table.dateTime("created_at").notNullable();
  });
  const rows = Array.from({ length: 410 }, (_, index) => ({
    id: index + 1,
    workspace_id: index % 2 + 1,
    name: `Book ${index + 1}`,
    created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, Math.floor(index / 6)))
  }));
  await knex.batchInsert("books", rows, 100);

  const resource = defineCrudResource({
    namespace: "books",
    tableName: "books",
    autofilter: "workspace",
    defaultSort: ["-createdAt"],
    crudOperations: ["list"],
    schema: {
      id: { type: "id", primary: true },
      workspaceId: { type: "id", column: "workspace_id" },
      name: {
        type: "string",
        operations: { output: { required: true } }
      },
      createdAt: { type: "dateTime", temporalPrecision: 3, column: "created_at" }
    }
  });
  const api = await createJsonRestApiHost({ knex });
  await addResourceIfMissing(api, "books", createJsonRestResourceScopeOptions(resource));
  const repository = createCrudJsonApiRepository({ api, knex, resource, resourceScopeName: "books" });
  const service = createCrudJsonApiService({ repository });
  const actions = createActionCatalogue();
  actions.register({
    contributorId: "test.books",
    domain: "books",
    actions: createCrudJsonApiActions({
      namespace: "books",
      resource,
      service,
      surface: "admin",
      operations: ["list"],
      permissionForOperation: () => ({ require: "all", permissions: ["books.list"] })
    })
  });
  const catalog = createServiceToolCatalog(actions, { maxDirectTools: 0 });
  const context = {
    actor: { id: "7" },
    permissions: ["books.list"],
    surface: "admin",
    scopeValues: { workspaceId: "1" }
  };
  const toolSet = catalog.resolveToolSet(context);
  const search = await catalog.executeToolCall({
    toolName: "assistant_action_search",
    argumentsText: JSON.stringify({ query: "books list" }),
    context,
    toolSet
  });
  assert.equal(search.ok, true);
  assert.deepEqual(search.result.items.map((item) => item.actionId), ["crud.books.list"]);
  const contract = await catalog.executeToolCall({
    toolName: "assistant_action_contract",
    argumentsText: JSON.stringify({ actionId: "crud.books.list", version: 1 }),
    context,
    toolSet
  });
  assert.equal(contract.ok, true);
  const expectedIds = await knex("books")
    .where("workspace_id", 1)
    .orderBy("created_at", "desc")
    .orderBy("id", "asc")
    .pluck("id");

  for (const limit of [100, 200]) {
    await t.test(`requested limit ${limit}`, async () => {
      const ids = [];
      const cursors = new Set();
      const pageSizes = [];
      let cursor = null;
      for (let page = 0; page < 4; page++) {
        const response = await catalog.executeToolCall({
          toolName: "assistant_action_execute",
          argumentsText: JSON.stringify({
            actionId: "crud.books.list",
            version: 1,
            input: {
              fields: { books: ["id", "name"] },
              limit,
              ...(cursor ? { cursor } : {})
            }
          }),
          context,
          toolSet
        });
        assert.equal(response.ok, true, JSON.stringify(response));
        const result = response.result.result;
        pageSizes.push(result.items.length);
        for (const item of result.items) {
          assert.deepEqual(Object.keys(item).sort(), ["id", "name"]);
          assert.equal(item.name, `Book ${item.id}`);
          ids.push(item.id);
        }
        cursor = result.nextCursor;
        if (cursor === null) break;
        assert.equal(typeof cursor, "string");
        assert.equal(cursors.has(cursor), false, "Each page must advance its cursor");
        cursors.add(cursor);
      }
      assert.equal(cursor, null, "Traversal must reach the end");
      assert.deepEqual(pageSizes, [100, 100, 5]);
      assert.deepEqual(ids, expectedIds.map(String));
      assert.equal(new Set(ids).size, 205);
    });
  }
});
