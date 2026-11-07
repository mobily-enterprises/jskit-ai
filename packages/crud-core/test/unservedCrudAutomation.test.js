import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { defineCrudJsonApiFeature } from "../src/server/defineCrudJsonApiFeature.js";

function createResource(namespace) {
  const resource = defineTableResource({
    name: namespace,
    tableName: namespace,
    schema: {
      reason: { type: "string", required: true }
    }
  });
  return defineCrudContract(resource, {
    operations: ["list", "view"],
    fields: { reason: { output: "required" } }
  });
}

function valueProvider(id, capability, value) {
  return defineProvider({
    id,
    provides: { value: capability },
    setup: () => ({ value })
  });
}

/** Starts the CRUD features with stand-in database, HTTP and JSON:API capabilities, and returns runtime.actions. */
async function startFeatures(context, features) {
  const jsonRestApi = {
    resources: {},
    async addResource(name, config) {
      this.resources[name] = { config };
    }
  };
  let actions;
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider,
      ActionProvider,
      valueProvider("test.database", "runtime.database", { knex: Object.assign(() => {}, { transaction: (callback) => callback({}) }) }),
      valueProvider("test.http", "runtime.http", { router: { register() {} } }),
      valueProvider("test.json-rest-api", "runtime.json-rest-api", jsonRestApi),
      ...features,
      defineProvider({
        id: "test.observer",
        requires: { catalogue: "runtime.actions" },
        setup({ catalogue }) {
          actions = catalogue;
          return {};
        }
      })
    ]
  });
  await runtime.start();
  context.after(() => runtime.shutdown());
  return actions;
}

function toolActionIds(actions, permissions) {
  const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
  const toolSet = catalog.resolveToolSet({ actor: { id: "7" }, permissions, surface: "home" });
  return toolSet.tools.map((tool) => tool.actionId).sort();
}

test("the assistant reaches a CRUD action without HTTP routes only when a permission guards it", async (context) => {
  const actions = await startFeatures(context, [
    defineCrudJsonApiFeature({ resource: createResource("books"), surface: "home" }),
    defineCrudJsonApiFeature({ resource: createResource("blocks"), surface: "home", internal: true, routes: false }),
    defineCrudJsonApiFeature({ resource: createResource("drafts"), surface: "home", internal: true }),
    defineCrudJsonApiFeature({
      resource: createResource("audits"),
      surface: "home",
      routes: false,
      permissions: { list: "app.admin" },
      actions: {
        summary: { kind: "query", input: { schema: createSchema({}) }, execute: async () => ({}) }
      }
    })
  ]);

  for (const id of ["crud.blocks.list", "crud.blocks.view", "crud.drafts.list", "crud.audits.view", "crud.audits.summary"]) {
    assert.deepEqual(actions.getDefinition(id).channels, ["api", "internal"], id);
  }
  for (const id of ["crud.books.list", "crud.books.view", "crud.audits.list"]) {
    assert.deepEqual(actions.getDefinition(id).channels, ["api", "automation", "internal"], id);
  }

  assert.deepEqual(toolActionIds(actions, []), ["crud.books.list", "crud.books.view"]);
  assert.deepEqual(toolActionIds(actions, ["app.admin"]), ["crud.audits.list", "crud.books.list", "crud.books.view"]);
});
