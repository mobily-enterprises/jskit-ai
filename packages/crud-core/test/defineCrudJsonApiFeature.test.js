import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { defineCrudJsonApiFeature } from "../src/server/defineCrudJsonApiFeature.js";
import { registerCrudJsonApiRoutes } from "../src/server/jsonApiModule/routes.js";

function createBookResource({ apiAccess = "authenticated", autofilter = "user" } = {}) {
  return defineCrudResource({
    namespace: "books",
    tableName: "books",
    apiAccess,
    autofilter,
    schema: {
      title: {
        type: "string",
        required: true,
        operations: {
          output: { required: true },
          create: { required: true },
          patch: { required: false }
        }
      }
    }
  });
}

function schemaDefinition(structure = {}) {
  return Object.freeze({ schema: createSchema(structure), mode: "patch" });
}

function valueProvider(id, capability, value) {
  return defineProvider({
    id,
    provides: { value: capability },
    setup() {
      return { value };
    }
  });
}

function createFeatureDependencies(routes) {
  const knex = Object.assign(() => {}, {
    async transaction(callback) {
      return callback({});
    }
  });
  const jsonRestApi = {
    resources: {},
    async addResource(name, config) {
      this.resources[name] = { config };
    }
  };
  const http = {
    router: {
      register(method, path, contract, handler) {
        routes.push({ method, path, contract, handler });
      }
    }
  };
  return [
    valueProvider("test.database", "runtime.database", { knex }),
    valueProvider("test.http", "runtime.http", http),
    valueProvider("test.json-rest-api", "runtime.json-rest-api", jsonRestApi)
  ];
}

test("defineCrudJsonApiFeature composes one resource without ceremonial token layers", async () => {
  const routes = [];
  const feature = defineCrudJsonApiFeature({
    resource: createBookResource(),
    surface: "app",
    relativePath: "/books"
  });
  let actions;
  let resourceApi;
  const observer = defineProvider({
    id: "test.observer",
    requires: {
      actions: "runtime.actions",
      books: "crud.books"
    },
    setup(dependencies) {
      actions = dependencies.actions;
      resourceApi = dependencies.books;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [
      createActionProvider(),
      ...createFeatureDependencies(routes),
      feature,
      observer
    ]
  });

  await runtime.start();

  assert.equal(feature.id, "crud.books");
  assert.deepEqual(feature.provides, { resourceApi: "crud.books" });
  assert.equal(resourceApi.resource.namespace, "books");
  assert.equal(typeof resourceApi.service.queryDocuments, "function");
  assert.equal(typeof resourceApi.repository.withTransaction, "function");
  assert.deepEqual(
    actions.listDefinitions().map((entry) => entry.id),
    ["crud.books.list", "crud.books.view", "crud.books.create", "crud.books.update", "crud.books.delete"]
  );
  assert.ok(actions.listDefinitions().every((entry) => entry.permission.require === "authenticated"));
  assert.ok(actions.listDefinitions().every((entry) => !Object.hasOwn(entry, "dependencies")));
  assert.deepEqual(
    actions.listDefinitions().map((entry) => [entry.id, entry.events.length]),
    [
      ["crud.books.list", 0],
      ["crud.books.view", 0],
      ["crud.books.create", 1],
      ["crud.books.update", 1],
      ["crud.books.delete", 1]
    ]
  );
  assert.deepEqual(routes.map((entry) => `${entry.method} ${entry.path}`), [
    "GET /api/books",
    "GET /api/books/:recordId",
    "POST /api/books",
    "PATCH /api/books/:recordId",
    "DELETE /api/books/:recordId"
  ]);
  await runtime.shutdown();
});

test("defineCrudJsonApiFeature makes workspace scope and permissions explicit", async () => {
  const routes = [];
  const feature = defineCrudJsonApiFeature({
    resource: createBookResource({ autofilter: "workspace" }),
    surface: "app",
    scope: {
      routeBase: "/w/:workspaceSlug",
      actionInputValidator: schemaDefinition({ workspaceSlug: { type: "string", required: true } }),
      routeParamsValidator: schemaDefinition({ workspaceSlug: { type: "string", required: true } }),
      inputKeys: ["workspaceSlug"],
      input: (request) => ({ workspaceSlug: request.input.params.workspaceSlug })
    }
  });
  let actions;
  const observer = defineProvider({
    id: "test.workspace-observer",
    requires: { actions: "runtime.actions" },
    setup({ actions: value }) {
      actions = value;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [createActionProvider(), ...createFeatureDependencies(routes), feature, observer]
  });

  await runtime.start();
  assert.deepEqual(
    actions.listDefinitions().map((entry) => entry.permission.permissions[0]),
    [
      "crud.books.list",
      "crud.books.view",
      "crud.books.create",
      "crud.books.update",
      "crud.books.delete"
    ]
  );
  await runtime.shutdown();
});

test("defineCrudJsonApiFeature rejects implicit workspace scope and public private ownership", () => {
  assert.throws(
    () => defineCrudJsonApiFeature({
      resource: createBookResource({ autofilter: "workspace" }),
      surface: "app"
    }),
    /requires explicit scope routeBase, actionInputValidator, routeParamsValidator, inputKeys, input/u
  );
  assert.throws(
    () => defineCrudJsonApiFeature({
      resource: createBookResource({ apiAccess: "public", autofilter: "user" }),
      surface: "public"
    }),
    /public CRUD feature requires ownershipFilter "public"/u
  );
});

test("registerCrudJsonApiRoutes forwards scope, record, query, and body values to actions", async () => {
  const routes = [];
  registerCrudJsonApiRoutes(
    {
      register(method, path, contract, handler) {
        routes.push({ method, path, contract, handler });
      }
    },
    {
      namespace: "books",
      resource: createBookResource({ autofilter: "workspace" }),
      routeBase: "/w/:workspaceSlug",
      relativePath: "/books",
      surface: "app",
      ownershipFilter: "workspace",
      access: "authenticated",
      scopeInput: (request) => ({ workspaceSlug: request.input.params.workspaceSlug })
    }
  );

  const actionCalls = [];
  const reply = {
    code(statusCode) { this.statusCode = statusCode; return this; },
    send(payload) { this.payload = payload; return this; }
  };
  await routes[3].handler({
    input: {
      params: { workspaceSlug: "library", recordId: "42" },
      body: { title: "The Left Hand of Darkness" }
    },
    executeAction(call) {
      actionCalls.push(call);
      return { data: { id: "42" } };
    }
  }, reply);

  assert.deepEqual(actionCalls, [{
    actionId: "crud.books.update",
    input: {
      workspaceSlug: "library",
      recordId: "42",
      title: "The Left Hand of Darkness"
    }
  }]);
  assert.equal(reply.statusCode, 200);
});
