import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { defineCrudJsonApiFeature } from "../src/server/defineCrudJsonApiFeature.js";
import { createCrudJsonApiActions } from "../src/server/jsonApiModule/actions.js";
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

function createReadOnlyBookResource() {
  return defineCrudResource({
    namespace: "books",
    tableName: "books",
    crudOperations: ["list", "view"],
    schema: {
      title: {
        type: "string",
        required: true,
        operations: { output: { required: true } }
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

test("defineCrudJsonApiFeature lets product services name exact capability dependencies", async () => {
  const routes = [];
  const access = {
    calls: [],
    async requireOwner(context) {
      this.calls.push(context);
    }
  };
  const feature = defineCrudJsonApiFeature({
    resource: createBookResource(),
    surface: "console",
    requires: { access: "console.access" },
    decorateService({ service, repository, resource, access: consoleAccess }) {
      assert.equal(resource.namespace, "books");
      assert.equal(typeof repository.createDocument, "function");
      return {
        ...service,
        async createDocument(payload, options) {
          await consoleAccess.requireOwner(options.context);
          return { data: { type: "books", attributes: payload } };
        }
      };
    }
  });
  let resourceApi;
  const observer = defineProvider({
    id: "test.product-service-observer",
    requires: { books: "crud.books" },
    setup({ books }) {
      resourceApi = books;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [
      createActionProvider(),
      ...createFeatureDependencies(routes),
      valueProvider("test.console-access", "console.access", access),
      feature,
      observer
    ]
  });

  await runtime.start();
  const context = { auth: { userId: "1" } };
  assert.deepEqual(
    await resourceApi.service.createDocument({ title: "Parable of the Sower" }, { context }),
    { data: { type: "books", attributes: { title: "Parable of the Sower" } } }
  );
  assert.deepEqual(access.calls, [context]);
  await runtime.shutdown();
});

test("defineCrudJsonApiFeature lets product repositories add only unique persistence operations", async () => {
  const routes = [];
  const feature = defineCrudJsonApiFeature({
    resource: createBookResource(),
    surface: "app",
    decorateRepository({ repository, database, resource }) {
      assert.equal(resource.namespace, "books");
      assert.equal(typeof database.knex.transaction, "function");
      return Object.freeze({
        ...repository,
        async countBooks() {
          return 12;
        }
      });
    }
  });
  let resourceApi;
  const observer = defineProvider({
    id: "test.product-repository-observer",
    requires: { books: "crud.books" },
    setup({ books }) {
      resourceApi = books;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [createActionProvider(), ...createFeatureDependencies(routes), feature, observer]
  });

  await runtime.start();
  assert.equal(await resourceApi.repository.countBooks(), 12);
  assert.equal(typeof resourceApi.repository.queryDocuments, "function");
  await runtime.shutdown();
});

test("defineCrudJsonApiFeature rejects reserved requirements and invalid decorators", () => {
  assert.throws(
    () => defineCrudJsonApiFeature({
      resource: createBookResource(),
      surface: "app",
      decorateRepository: {}
    }),
    /decorateRepository must be a function/u
  );
  assert.throws(
    () => defineCrudJsonApiFeature({
      resource: createBookResource(),
      surface: "app",
      requires: { database: "something.else" }
    }),
    /reserves the local name database/u
  );
  assert.throws(
    () => defineCrudJsonApiFeature({
      resource: createBookResource(),
      surface: "app",
      decorateService: {}
    }),
    /decorateService must be a function/u
  );
  assert.throws(
    () => defineCrudJsonApiFeature({
      resource: createBookResource(),
      surface: "app",
      operations: ["publish"]
    }),
    /Unknown CRUD operation/u
  );
});

test("defineCrudJsonApiFeature exposes only deliberately selected operations", async () => {
  const routes = [];
  const feature = defineCrudJsonApiFeature({
    resource: createBookResource(),
    surface: "app",
    relativePath: "/books",
    operations: ["list", "view"]
  });
  let actions;
  let resourceApi;
  const observer = defineProvider({
    id: "test.readonly-observer",
    requires: { actions: "runtime.actions", books: "crud.books" },
    setup({ actions: value, books }) {
      actions = value;
      resourceApi = books;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [createActionProvider(), ...createFeatureDependencies(routes), feature, observer]
  });

  await runtime.start();
  assert.deepEqual(actions.listDefinitions().map((entry) => entry.id), [
    "crud.books.list",
    "crud.books.view"
  ]);
  assert.deepEqual(routes.map((entry) => `${entry.method} ${entry.path}`), [
    "GET /api/books",
    "GET /api/books/:recordId"
  ]);
  assert.equal(typeof resourceApi.service.queryDocuments, "function");
  assert.equal(typeof resourceApi.service.getDocumentById, "function");
  assert.equal(resourceApi.service.createDocument, undefined);
  assert.equal(resourceApi.service.patchDocumentById, undefined);
  assert.equal(resourceApi.service.deleteDocumentById, undefined);
  await runtime.shutdown();
});

test("defineCrudJsonApiFeature supports resources that define only selected operations", async () => {
  const routes = [];
  const feature = defineCrudJsonApiFeature({
    resource: createReadOnlyBookResource(),
    surface: "app"
  });
  const runtime = createCapabilityRuntime({
    providers: [createActionProvider(), ...createFeatureDependencies(routes), feature]
  });

  await runtime.start();
  assert.deepEqual(routes.map((entry) => `${entry.method} ${entry.path}`), [
    "GET /api/books",
    "GET /api/books/:recordId"
  ]);
  await runtime.shutdown();
});

test("defineCrudJsonApiFeature can expose actions and capability without HTTP routes", async () => {
  const routes = [];
  const feature = defineCrudJsonApiFeature({
    resource: createBookResource(),
    surface: "app",
    operations: ["list", "view"],
    routes: false
  });
  let actions;
  const observer = defineProvider({
    id: "test.route-free-observer",
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
  assert.deepEqual(actions.listDefinitions().map((entry) => entry.id), [
    "crud.books.list",
    "crud.books.view"
  ]);
  assert.deepEqual(routes, []);
  await runtime.shutdown();
});

test("CRUD actions run a concise product guard before the standard operation", async () => {
  const calls = [];
  const service = {
    queryDocuments() {
      calls.push("service");
      return { data: [] };
    }
  };
  const resource = createBookResource();
  const actions = createCrudJsonApiActions({
    namespace: "books",
    resource,
    service,
    surface: "app",
    operations: ["list"],
    permissionForOperation: () => ({ require: "authenticated" }),
    beforeOperation({ operation, input, context, resource, service: guardedService }) {
      calls.push({ operation, input, context, resource, guardedService });
    }
  });
  const context = { actor: "tester" };
  const input = { q: "dog" };

  await actions[0].execute(input, context);

  assert.deepEqual(calls, [{
    operation: "list",
    input,
    context,
    resource,
    guardedService: service
  }, "service"]);
});

test("defineCrudJsonApiFeature rejects implicit workspace scope and public private ownership", () => {
  assert.throws(
    () => defineCrudJsonApiFeature({
      resource: createBookResource(),
      surface: "app",
      routes: "sometimes"
    }),
    /routes must be a boolean/u
  );
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
