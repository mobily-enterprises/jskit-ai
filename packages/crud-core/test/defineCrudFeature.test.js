import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { RestApiWriteError } from "json-rest-api";

import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { returnJsonApiData, returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { defineCrudFeature } from "../src/server/defineCrudFeature.js";
import { createCrudJsonApiActions } from "../src/server/jsonApiModule/actions.js";
import { crudJsonApiActionOptions, crudJsonApiRouteOptions } from "./support/crudJsonApiActionOptions.js";
import { registerCrudJsonApiRoutes } from "../src/server/jsonApiModule/routes.js";

function bookTable(ownership) {
  return defineTableResource({
    name: "books",
    tableName: "books",
    ownership,
    schema: {
      title: { type: "string", required: true }
    }
  });
}

function createBookResource({ apiAccess = "authenticated", ownership = "user" } = {}) {
  return defineCrudContract(bookTable(ownership), { namespace: "books", apiAccess });
}

function createReadOnlyBookResource() {
  return defineCrudContract(bookTable("public"), {
    namespace: "books",
    operations: ["list", "view"],
    fields: { title: { output: "required" } }
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

// A stand-in for one owned table's handle: the CRUD service's calls, answered as a JSON:API document.
function fakeHandle(resource) {
  return Object.freeze({
    name: resource.name,
    pageLimits: () => Object.freeze({ request: 100, server: 1000 }),
    async withTransaction(options, work) {
      return work(Object.freeze({ ...options, trx: "managed" }));
    },
    async query() {
      return { data: [] };
    },
    async get() {
      return null;
    },
    async create(attributes) {
      return { data: { type: resource.name, id: "1", attributes } };
    },
    async patch() {
      return null;
    },
    async delete() {
      return null;
    }
  });
}

function createFeatureDependencies(routes, owned = []) {
  const resources = {
    own(featureId, owns) {
      owned.push({ featureId, owns });
      return Object.freeze(Object.fromEntries(owns.map((entry) => {
        const resource = entry.resource || entry;
        return [resource.name, fakeHandle(resource)];
      })));
    },
    createSystemContext(declaration) {
      return Object.freeze({ system: true, ...declaration });
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
    valueProvider("test.resources", "runtime.resources", resources),
    valueProvider("test.http", "runtime.http", http)
  ];
}

test("defineCrudFeature composes one resource without ceremonial token layers", async () => {
  const routes = [];
  const feature = defineCrudFeature({
    crud: createBookResource(),
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
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider, ActionProvider,
      ...createFeatureDependencies(routes),
      feature,
      observer
    ]
  });

  await runtime.start();

  assert.equal(feature.id, "crud.books");
  assert.deepEqual(feature.provides, { resourceApi: "crud.books" });
  assert.equal(resourceApi.crud.namespace, "books");
  assert.equal(typeof resourceApi.service.list, "function");
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

test("defineCrudFeature sends record.changed to its realtime audience", async () => {
  const execution = { input: { recordId: "5" }, result: returnJsonApiDocument({ data: { id: "5" } }), context: {} };
  for (const [options, audience] of [[{}, "event_scope"], [{ realtimeAudience: "all_users" }, "all_users"]]) {
    let actions;
    const observer = defineProvider({
      id: "test.observer",
      requires: { actions: "runtime.actions", books: "crud.books" },
      setup(dependencies) {
        actions = dependencies.actions;
        return {};
      }
    });
    const runtime = createCapabilityRuntime({
      inputs: { "runtime.logger": silentLogger },
      providers: [
        EventProvider, ActionProvider,
        ...createFeatureDependencies([]),
        defineCrudFeature({
          crud: createBookResource({ apiAccess: "public", ownership: "public" }),
          surface: "home",
          ...options
        }),
        observer
      ]
    });
    await runtime.start();

    assert.deepEqual(
      actions.listDefinitions()
        .filter((entry) => entry.events.length > 0)
        .map((entry) => [entry.id, entry.events[0](execution).realtime]),
      ["create", "update", "delete"].map((operation) => [
        `crud.books.${operation}`,
        { event: "books.record.changed", audience }
      ])
    );
    await runtime.shutdown();
  }
});

test("defineCrudFeature makes workspace scope and permissions explicit", async () => {
  const routes = [];
  const feature = defineCrudFeature({
    crud: createBookResource({ ownership: "workspace" }),
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
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, ...createFeatureDependencies(routes), feature, observer]
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

test("a scoped CRUD custom action's input keeps its own mode, and one without a mode is create", async () => {
  const routes = [];
  const feature = defineCrudFeature({
    crud: createBookResource({ ownership: "workspace" }),
    surface: "app",
    scope: {
      routeBase: "/w/:workspaceSlug",
      actionInputValidator: schemaDefinition({ workspaceSlug: { type: "string", required: true } }),
      routeParamsValidator: schemaDefinition({ workspaceSlug: { type: "string", required: true } }),
      inputKeys: ["workspaceSlug"],
      input: (request) => ({ workspaceSlug: request.input.params.workspaceSlug })
    },
    actions: {
      archive: {
        input: { schema: createSchema({ recordId: { type: "string", required: true } }) },
        execute: ({ input }) => input
      },
      rename: {
        input: schemaDefinition({ recordId: { type: "string", required: true }, title: { type: "string" } }),
        execute: ({ input }) => input
      }
    }
  });
  let actions;
  const observer = defineProvider({
    id: "test.custom-mode-observer",
    requires: { actions: "runtime.actions" },
    setup({ actions: value }) {
      actions = value;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, ...createFeatureDependencies(routes), feature, observer]
  });

  await runtime.start();
  const archive = actions.getDefinition("crud.books.archive").input;
  const rename = actions.getDefinition("crud.books.rename").input;
  assert.equal(archive.mode, "create");
  assert.deepEqual(Object.keys(archive.schema.getFieldDefinitions()), ["workspaceSlug", "recordId"]);
  assert.equal(rename.mode, "patch");
  await runtime.shutdown();
});

test("a CRUD custom action that declares idempotency stops the feature from starting", async () => {
  const feature = defineCrudFeature({
    crud: createBookResource(),
    surface: "app",
    actions: {
      archive: {
        input: schemaDefinition({ recordId: { type: "string", required: true } }),
        idempotency: "optional",
        execute: ({ input }) => input
      }
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, ...createFeatureDependencies([]), feature]
  });

  await assert.rejects(
    runtime.start(),
    { message: "CRUD custom action \"archive\" declares idempotency. Action definitions no longer declare idempotency." }
  );
});

test("generated CRUD actions expose truthful assistant contracts without changing native results", async () => {
  const resource = createBookResource();
  const document = (id, title) => ({
    data: {
      type: "books",
      id,
      attributes: { title }
    }
  });
  const actions = createCrudJsonApiActions(crudJsonApiActionOptions({
    namespace: "books",
    resource,
    service: {
      async list() {
        return returnJsonApiDocument({
          data: [document("1", "Kindred").data],
          meta: { pagination: { cursor: { next: "cursor-2" } } }
        });
      },
      async view() {
        return returnJsonApiDocument(document("1", "Kindred"));
      },
      async create() {
        return returnJsonApiDocument(document("2", "Parable of the Sower"));
      },
      async patch() {
        return returnJsonApiDocument(document("1", "Kindred (updated)"));
      },
      async delete() {
        return null;
      }
    },
    surface: "admin",
    permissionForOperation: () => ({ require: "authenticated" })
  }));
  const byOperation = new Map(actions.map((entry) => [entry.id.split(".").at(-1), entry]));

  assert.ok(actions.every((entry) => entry.output === null));
  assert.notEqual(byOperation.get("list").extensions.assistant.output, resource.operations.list.output);
  assert.notEqual(byOperation.get("view").extensions.assistant.output, resource.operations.view.output);
  assert.equal(byOperation.get("create").extensions.assistant.output, resource.operations.create.output);
  assert.equal(byOperation.get("update").extensions.assistant.output, resource.operations.patch.output);
  assert.equal(byOperation.get("delete").extensions.assistant.output, resource.operations.delete.output);
  const sparseListContract = byOperation.get("list").extensions.assistant.output.schema.toJsonSchema({ mode: "replace" });
  const sparseListItemContract = Object.values(sparseListContract.definitions)[0];
  assert.deepEqual(sparseListItemContract.required, ["id"]);
  assert.deepEqual(
    byOperation.get("view").extensions.assistant.output.schema.toJsonSchema({ mode: "replace" }).required,
    ["id"]
  );

  const transform = async (operation, input = {}) => {
    const definition = byOperation.get(operation);
    const nativeResult = await definition.execute(input, {});
    const assistantResult = await definition.extensions.assistant.transformResult(nativeResult, { input });
    return validateSchemaPayload(definition.extensions.assistant.output, assistantResult, {
      phase: "output"
    });
  };

  assert.deepEqual(await transform("list"), {
    items: [{ id: "1", title: "Kindred" }],
    nextCursor: "cursor-2"
  });
  assert.deepEqual(await transform("view", { recordId: "1" }), {
    id: "1",
    title: "Kindred"
  });
  assert.deepEqual(await transform("create", { title: "Parable of the Sower" }), {
    id: "2",
    title: "Parable of the Sower"
  });
  assert.deepEqual(await transform("update", { recordId: "1", title: "Kindred (updated)" }), {
    id: "1",
    title: "Kindred (updated)"
  });
  assert.deepEqual(await transform("delete", { recordId: "1" }), {
    id: "1",
    deleted: true
  });

  assert.deepEqual(await byOperation.get("view").execute({ recordId: "1" }, {}),
    returnJsonApiDocument(document("1", "Kindred")));
});

test("defineCrudFeature lets product services name exact capability dependencies", async () => {
  const routes = [];
  const access = {
    calls: [],
    async requireOwner(context) {
      this.calls.push(context);
    }
  };
  const feature = defineCrudFeature({
    crud: createBookResource(),
    surface: "console",
    requires: { access: "console.access" },
    decorateService({ service, repository, crud, access: consoleAccess }) {
      assert.equal(crud.namespace, "books");
      assert.equal(typeof repository.create, "function");
      return {
        ...service,
        async create(payload, options) {
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
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider, ActionProvider,
      ...createFeatureDependencies(routes),
      valueProvider("test.console-access", "console.access", access),
      feature,
      observer
    ]
  });

  await runtime.start();
  const context = { auth: { userId: "1" } };
  assert.deepEqual(
    await resourceApi.service.create({ title: "Parable of the Sower" }, { context }),
    { data: { type: "books", attributes: { title: "Parable of the Sower" } } }
  );
  assert.deepEqual(access.calls, [context]);
  await runtime.shutdown();
});

test("defineCrudFeature lets product repositories add only unique persistence operations", async () => {
  const routes = [];
  const feature = defineCrudFeature({
    crud: createBookResource(),
    surface: "app",
    decorateRepository({ repository, resources, crud }) {
      assert.equal(crud.namespace, "books");
      assert.equal(resources.books, repository);
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
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, ...createFeatureDependencies(routes), feature, observer]
  });

  await runtime.start();
  assert.equal(await resourceApi.repository.countBooks(), 12);
  assert.equal(typeof resourceApi.repository.query, "function");
  await runtime.shutdown();
});

test("defineCrudFeature owns its CRUD table, takes its extras from owns, and hands a system context to decorateRepository", async () => {
  const crud = createBookResource({ ownership: "public" });
  const notes = defineTableResource({ name: "bookNotes", tableName: "book_notes", ownership: "public", schema: { body: { type: "string" } } });
  const archived = defineCrudContract(defineTableResource({
    name: "archivedBooks",
    tableName: "archived_books",
    ownership: "public",
    schema: { title: { type: "string", required: true } }
  }), { namespace: "archivedBooks" });
  const rowPolicy = () => true;
  const owned = [];
  let received = null;
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider, ActionProvider,
      ...createFeatureDependencies([], owned),
      defineCrudFeature({ crud, surface: "home", owns: [notes] }),
      defineCrudFeature({
        crud: archived,
        id: "crud.archived-books",
        surface: "home",
        relativePath: "/archived-books",
        owns: [{ resource: archived.resource, rowPolicy }],
        systemScope: "archive old books in every workspace",
        decorateRepository(dependencies) {
          received = dependencies;
          return dependencies.repository;
        }
      })
    ]
  });

  await runtime.start();
  const ownedBy = Object.fromEntries(owned.map(({ featureId, owns }) => [featureId, owns]));
  assert.deepEqual(Object.fromEntries(Object.entries(ownedBy).map(([featureId, owns]) => [featureId, owns.map((entry) => entry.resource?.name || entry.name)])), {
    "crud.books": ["books", "bookNotes"],
    "crud.archived-books": ["archivedBooks"]
  });
  assert.equal(ownedBy["crud.archived-books"][0].rowPolicy, rowPolicy);
  assert.deepEqual(Object.keys(received.resources), ["archivedBooks"]);
  assert.equal(received.systemContext("move them").reason, "move them");
  assert.equal(Object.keys(received).includes("http"), false);
  await runtime.shutdown();
});

test("defineCrudFeature serves a table another feature owns through the owner's repository, at the visibility it names", async () => {
  const routes = [];
  const owned = [];
  const usersRepository = Object.freeze({ name: "users", pageLimits: () => Object.freeze({ request: 100, server: 1000 }) });
  const users = defineCrudContract(defineTableResource({
    name: "users",
    tableName: "users",
    ownership: "public",
    schema: { displayName: { type: "string" } }
  }), { namespace: "users", operations: ["list", "view"] });
  let actions;
  let resourceApi;
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider, ActionProvider,
      ...createFeatureDependencies(routes, owned),
      valueProvider("test.users-owner", "users.profiles", usersRepository),
      defineCrudFeature({
        crud: users,
        id: "app.users-workspace",
        surface: "admin",
        ownerRepository: "users.profiles",
        visibility: "workspace",
        scope: {
          routeBase: "/w/:workspaceSlug",
          actionInputValidator: schemaDefinition({ workspaceSlug: { type: "string", required: true } }),
          routeParamsValidator: schemaDefinition({ workspaceSlug: { type: "string", required: true } }),
          inputKeys: ["workspaceSlug"],
          input: (request) => ({ workspaceSlug: request.input.params.workspaceSlug })
        }
      }),
      defineProvider({
        id: "test.users-observer",
        requires: { actions: "runtime.actions", users: "app.users-workspace" },
        setup(dependencies) {
          actions = dependencies.actions;
          resourceApi = dependencies.users;
          return {};
        }
      })
    ]
  });

  await runtime.start();
  assert.deepEqual(owned, []);
  assert.equal(resourceApi.repository, usersRepository);
  assert.deepEqual(routes.map((entry) => [entry.path, entry.contract.visibility]), [
    ["/api/w/:workspaceSlug/users", "workspace"],
    ["/api/w/:workspaceSlug/users/:recordId", "workspace"]
  ]);
  assert.deepEqual(actions.listDefinitions().map((entry) => entry.permission.permissions), [["crud.users.list"], ["crud.users.view"]]);
  await runtime.shutdown();
  assert.throws(
    () => defineCrudFeature({ crud: users, surface: "admin", ownerRepository: "users.profiles", owns: [users.resource] }),
    /serves "users" through users\.profiles, so it cannot own it too/u
  );
});

test("defineCrudFeature rejects reserved requirements and invalid decorators", () => {
  assert.throws(
    () => defineCrudFeature({
      crud: createBookResource(),
      surface: "app",
      decorateRepository: {}
    }),
    /decorateRepository must be a function/u
  );
  assert.throws(
    () => defineCrudFeature({
      crud: createBookResource(),
      surface: "app",
      requires: { repository: "something.else" }
    }),
    /reserves the local name repository/u
  );
  assert.throws(
    () => defineCrudFeature({
      crud: createBookResource(),
      surface: "app",
      decorateService: {}
    }),
    /decorateService must be a function/u
  );
  assert.throws(
    () => defineCrudFeature({
      crud: createBookResource(),
      surface: "app",
      operations: ["publish"]
    }),
    /Unknown CRUD operation/u
  );
});

test("defineCrudFeature refuses an option it does not take, naming where an earlier one now goes", () => {
  const base = { crud: createBookResource(), surface: "app" };
  for (const [option, hint] of [
    ["ownershipFilter", /no longer takes ownershipFilter: use visibility/u],
    ["searchSchema", /no longer takes searchSchema: use an owns entry: owns: \[\{ resource, searchSchema \}\]/u],
    ["rowPolicy", /no longer takes rowPolicy: use an owns entry/u],
    ["resource", /no longer takes resource: use crud, the CRUD contract/u],
    ["routePrefix", /does not take routePrefix\. Its options are crud, id, capability, surface/u]
  ]) {
    assert.throws(() => defineCrudFeature({ ...base, [option]: {} }), hint, option);
  }
});

test("defineCrudFeature refuses a permission for an action it does not define", () => {
  const base = { crud: createBookResource(), surface: "app" };
  assert.throws(
    () => defineCrudFeature({ ...base, permissions: { patch: { require: "authenticated" } } }),
    /permissions\.patch names no action of the feature \(a patch is the "update" action\)\. Its actions are list, view, create, update, delete\./u
  );
  assert.throws(
    () => defineCrudFeature({ ...base, permissions: { Update: { require: "authenticated" } } }),
    /reads the permission of action Update as permissions\.update; name it so/u
  );
  defineCrudFeature({ ...base, permissions: { update: { require: "authenticated" } } });
});

/**
 * Starts a CRUD feature on stand-in dependencies, answering how its start ended.
 * @param {object} options defineCrudFeature's options.
 */
async function startFeature(options) {
  const feature = defineCrudFeature({ crud: createBookResource(), surface: "app", ...options });
  let resourceApi;
  const observer = defineProvider({
    id: "test.removed-api-observer",
    requires: { books: "crud.books" },
    setup({ books }) {
      resourceApi = books;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, ...createFeatureDependencies([]), feature, observer]
  });
  await runtime.start();
  return { resourceApi, runtime };
}

test("a decorated repository or service still defining a method of the earlier API stops the feature", async () => {
  await assert.rejects(
    () => startFeature({
      decorateRepository: ({ repository }) => ({ ...repository, async queryDocuments() {}, async applyForUpdate() {} })
    }),
    /The repository decorateRepository returned defines queryDocuments\(\), applyForUpdate\(\).*queryDocuments\(\) is now query\(\{ page: \{ size \} \}, options\); applyForUpdate\(\) is now lock\(id, txOptions\) inside withTransaction/su
  );
  await assert.rejects(
    () => startFeature({
      decorateService: ({ service }) => ({ ...service, async updateRecord() {} })
    }),
    /The service decorateService returned defines updateRecord\(\).*updateRecord\(\) is now patch\(recordId, payload, options\)/su
  );
});

test("a decorated service without an enabled operation's method stops the feature", async () => {
  await assert.rejects(
    () => startFeature({
      decorateService: ({ service }) => ({ list: service.list, view: service.view })
    }),
    /decorateService must return a service with its own create\(\), which the create operation calls; spread the service/u
  );
  const { runtime } = await startFeature({
    operations: ["list", "view"],
    decorateService: ({ service }) => ({ list: service.list, view: service.view })
  });
  await runtime.shutdown();
});

test("reading a dependency or capability property the redesign removed throws, naming its replacement", async () => {
  const seen = {};
  const { resourceApi, runtime } = await startFeature({
    decorateRepository(dependencies) {
      for (const name of ["database", "http", "jsonRestApi", "resource"]) {
        seen[name] = captureMessage(() => dependencies[name]);
      }
      // Spreading the dependencies, as a decorator may, skips the removed names.
      assert.deepEqual(Object.keys({ ...dependencies }).sort(), ["crud", "repository", "resources"]);
      return dependencies.repository;
    },
    decorateService(dependencies) {
      seen.serviceResource = captureMessage(() => dependencies.resource);
      return dependencies.service;
    }
  });
  try {
    assert.match(captureMessage(() => resourceApi.resource), /A CRUD feature's capability no longer has resource: it is now crud, the CRUD contract\./u);
    assert.equal(resourceApi.crud.namespace, "books");
    assert.match(seen.database, /decorateRepository's dependencies no longer has database: read and write through repository and resources/u);
    assert.match(seen.http, /no longer has http: defineCrudFeature registers the routes/u);
    assert.match(seen.jsonRestApi, /no longer has jsonRestApi: each owned table's handle is in resources/u);
    assert.match(seen.resource, /no longer has resource: it is now crud, the CRUD contract/u);
    assert.match(seen.serviceResource, /decorateService's dependencies no longer has resource: it is now crud/u);
  } finally {
    await runtime.shutdown();
  }
});

test("the CRUD service's view refuses forUpdate, naming lock()", async () => {
  const { resourceApi, runtime } = await startFeature({});
  try {
    await assert.rejects(
      () => resourceApi.service.view("1", {}, { context: {}, forUpdate: true }),
      /view\(\) no longer takes forUpdate: lock the record with the repository's lock\(recordId, txOptions\) inside repository\.withTransaction/u
    );
  } finally {
    await runtime.shutdown();
  }
});

function captureMessage(read) {
  try {
    read();
  } catch (error) {
    return error.message;
  }
  return assert.fail("expected the read to throw");
}

test("defineCrudFeature exposes only deliberately selected operations", async () => {
  const routes = [];
  const feature = defineCrudFeature({
    crud: createBookResource(),
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
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, ...createFeatureDependencies(routes), feature, observer]
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
  assert.equal(typeof resourceApi.service.list, "function");
  assert.equal(typeof resourceApi.service.view, "function");
  assert.equal(resourceApi.service.create, undefined);
  assert.equal(resourceApi.service.patch, undefined);
  assert.equal(resourceApi.service.delete, undefined);
  await runtime.shutdown();
});

test("defineCrudFeature supports resources that define only selected operations", async () => {
  const routes = [];
  const feature = defineCrudFeature({
    crud: createReadOnlyBookResource(),
    surface: "app"
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, ...createFeatureDependencies(routes), feature]
  });

  await runtime.start();
  assert.deepEqual(routes.map((entry) => `${entry.method} ${entry.path}`), [
    "GET /api/books",
    "GET /api/books/:recordId"
  ]);
  await runtime.shutdown();
});

test("defineCrudFeature can expose actions and capability without HTTP routes", async () => {
  const routes = [];
  const feature = defineCrudFeature({
    crud: createBookResource(),
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
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, ...createFeatureDependencies(routes), feature, observer]
  });

  await runtime.start();
  assert.deepEqual(actions.listDefinitions().map((entry) => entry.id), [
    "crud.books.list",
    "crud.books.view"
  ]);
  assert.deepEqual(routes, []);
  await runtime.shutdown();
});

test("CRUD operation lifecycle wraps a mutation transaction and runs afterCommit last", async () => {
  const calls = [];
  let txOptions = null;
  const service = {
    patch(recordId, patch, options) {
      calls.push(["service", recordId, patch, options]);
      return { data: { id: recordId, attributes: patch } };
    }
  };
  const repository = {
    async withTransaction(options, work) {
      calls.push("transaction:begin");
      txOptions = Object.freeze({ ...options, trx: { id: "transaction" } });
      const result = await work(txOptions);
      calls.push("transaction:commit");
      return result;
    }
  };
  const resource = createBookResource();
  const actions = createCrudJsonApiActions(crudJsonApiActionOptions({
    namespace: "books",
    resource,
    repository,
    service,
    surface: "app",
    operations: ["update"],
    permissionForOperation: () => ({ require: "authenticated" }),
    operationLifecycle: {
      update: {
        before({ operation, input, context, options }) {
          calls.push(["before", operation, input.recordId, context.actor, options]);
        },
        execute({ input, standard }) {
          calls.push("execute");
          return standard({ ...input, title: input.title.trim() });
        },
        after({ result, options }) {
          calls.push(["after", result.data.id, options]);
        },
        afterCommit({ result, options }) {
          calls.push(["afterCommit", result.data.id, options]);
        }
      }
    }
  }));
  const context = { actor: "tester" };
  const input = { recordId: "42", title: "  Kindred  " };

  await actions[0].execute(input, context);

  // The hooks and the standard operation share the transaction's options; afterCommit gets the context alone.
  assert.deepEqual(calls, [
    "transaction:begin",
    ["before", "update", "42", "tester", txOptions],
    "execute",
    ["service", "42", { title: "Kindred" }, txOptions],
    ["after", "42", txOptions],
    "transaction:commit",
    ["afterCommit", "42", { context }]
  ]);
  assert.equal(calls[1][4].context, context);
});

test("a CRUD lifecycle hook reading trx fails, naming options", async () => {
  const actions = createCrudJsonApiActions(crudJsonApiActionOptions({
    namespace: "books",
    resource: createBookResource(),
    repository: {
      async withTransaction(options, work) {
        return work(Object.freeze({ ...options, trx: { id: "transaction" } }));
      }
    },
    service: {
      patch(recordId, patch) {
        return { data: { id: recordId, attributes: patch } };
      }
    },
    surface: "app",
    operations: ["update"],
    permissionForOperation: () => ({ require: "authenticated" }),
    operationLifecycle: {
      update: {
        before({ trx }) {
          return trx;
        }
      }
    }
  }));

  await assert.rejects(
    () => actions[0].execute({ recordId: "42", title: "Kindred" }, { actor: "tester" }),
    /A CRUD lifecycle hook's argument no longer has trx: pass options, which carries the operation's transaction/u
  );
});

test("CRUD operation lifecycle does not run after or afterCommit when the transaction fails", async () => {
  const calls = [];
  const error = new Error("write failed");
  const actions = createCrudJsonApiActions(crudJsonApiActionOptions({
    namespace: "books",
    resource: createBookResource(),
    repository: {
      async withTransaction(options, work) {
        calls.push("transaction:begin");
        return work({ ...options, trx: "transaction" });
      }
    },
    service: {
      async patch() {
        calls.push("service");
        throw error;
      }
    },
    surface: "app",
    operations: ["update"],
    permissionForOperation: () => ({ require: "authenticated" }),
    operationLifecycle: {
      update: {
        before() { calls.push("before"); },
        after() { calls.push("after"); },
        afterCommit() { calls.push("afterCommit"); }
      }
    }
  }));

  await assert.rejects(
    actions[0].execute({ recordId: "42", title: "Kindred" }, {}),
    (value) => value === error
  );
  assert.deepEqual(calls, ["transaction:begin", "before", "service"]);
});

test("a CRUD create that returns no tagged JSON:API result with the record id fails before its after hooks, in every channel", async () => {
  const createdDocument = { data: { type: "books", id: "7", attributes: { title: "Kindred" } } };
  const results = [
    createdDocument,
    { id: "7", title: "Kindred" },
    { kind: "document", value: createdDocument },
    returnJsonApiDocument({ data: null }),
    returnJsonApiData({ title: "Kindred" })
  ];
  for (const returned of results) {
    const calls = [];
    const actions = createCrudJsonApiActions(crudJsonApiActionOptions({
      namespace: "books",
      resource: createBookResource(),
      repository: {
        async withTransaction(options, work) {
          calls.push("transaction:begin");
          const result = await work({ ...options, trx: "transaction" });
          calls.push("transaction:commit");
          return result;
        }
      },
      service: {
        async create() {
          return returnJsonApiDocument(createdDocument);
        }
      },
      surface: "app",
      operations: ["create"],
      permissionForOperation: () => ({ require: "authenticated" }),
      operationLifecycle: {
        create: {
          execute() { return returned; },
          after() { calls.push("after"); },
          afterCommit() { calls.push("afterCommit"); }
        }
      }
    }));

    await assert.rejects(
      actions[0].execute({ title: "Kindred" }, {}),
      /CRUD books create must return the created record, with its id, as a tagged JSON:API result/
    );
    assert.deepEqual(calls, ["transaction:begin"]);
  }

  const decoratedActions = createCrudJsonApiActions(crudJsonApiActionOptions({
    namespace: "books",
    resource: createBookResource(),
    repository: {},
    service: {
      async create() {
        return createdDocument;
      }
    },
    surface: "app",
    operations: ["create"],
    permissionForOperation: () => ({ require: "authenticated" })
  }));
  await assert.rejects(
    decoratedActions[0].execute({ title: "Kindred" }, {}),
    /CRUD books create must return the created record, with its id, as a tagged JSON:API result/
  );

  for (const returned of [returnJsonApiDocument(createdDocument), returnJsonApiData({ id: 7, title: "Kindred" })]) {
    const acceptedActions = createCrudJsonApiActions(crudJsonApiActionOptions({
      namespace: "books",
      resource: createBookResource(),
      repository: {},
      service: {
        async create() {
          return returned;
        }
      },
      surface: "app",
      operations: ["create"],
      permissionForOperation: () => ({ require: "authenticated" })
    }));
    const result = await acceptedActions[0].execute({ title: "Kindred" }, {});
    assert.equal(result, returned);
    assert.equal(acceptedActions[0].events[0]({ input: {}, result, context: {} }).entityId, "7");
  }
});

test("CRUD afterCommit failures preserve the original cause and acknowledged commit", async () => {
  for (const failure of [new Error("notification failed"), Object.freeze(new Error("frozen failure")), null, undefined]) {
    let committed = false;
    const actions = createCrudJsonApiActions(crudJsonApiActionOptions({
      namespace: "books",
      resource: createBookResource(),
      repository: {
        async withTransaction(options, work) {
          const result = await work({ ...options, trx: "transaction" });
          committed = true;
          return result;
        }
      },
      service: {
        patch(id, attributes) { return { data: { id, attributes } }; }
      },
      surface: "app",
      operations: ["update"],
      permissionForOperation: () => ({ require: "authenticated" }),
      operationLifecycle: {
        update: { afterCommit() { assert.equal(committed, true); throw failure; } }
      }
    }));
    await assert.rejects(
      () => actions[0].execute({ recordId: "42", title: "Kindred" }, {}),
      (error) => {
        assert.ok(error instanceof RestApiWriteError);
        assert.equal(error.transactionOutcome, "committed");
        assert.equal(error.cause, failure);
        return true;
      }
    );
  }
});

test("CRUD failures before acknowledged commit are not marked committed", async () => {
  for (const phase of ["before", "after", "commit"]) {
    const failure = Object.freeze(new Error(`${phase} failed`));
    let committed = false;
    let afterCommitCalled = false;
    const actions = createCrudJsonApiActions(crudJsonApiActionOptions({
      namespace: "books",
      resource: createBookResource(),
      repository: {
        async withTransaction(options, work) {
          const result = await work({ ...options, trx: "transaction" });
          if (phase === "commit") throw failure;
          committed = true;
          return result;
        }
      },
      service: {
        patch(id, attributes) { return { data: { id, attributes } }; }
      },
      surface: "app",
      operations: ["update"],
      permissionForOperation: () => ({ require: "authenticated" }),
      operationLifecycle: {
        update: {
          before() { if (phase === "before") throw failure; },
          after() { if (phase === "after") throw failure; },
          afterCommit() { afterCommitCalled = true; }
        }
      }
    }));
    await assert.rejects(
      () => actions[0].execute({ recordId: "42", title: "Kindred" }, {}),
      (error) => error === failure && error.transactionOutcome === undefined
    );
    assert.equal(committed, false);
    assert.equal(afterCommitCalled, false);
  }
});

test("defineCrudFeature exposes custom service methods as actions and optional routes", async () => {
  const routes = [];
  const calls = [];
  const confirmInput = schemaDefinition({
    recordId: { type: "string", required: true },
    note: { type: "string", required: false }
  });
  const feature = defineCrudFeature({
    crud: createBookResource(),
    surface: "app",
    relativePath: "/books",
    decorateService({ service }) {
      return Object.freeze({
        ...service,
        async confirmBook(recordId, { note, context } = {}) {
          calls.push({ recordId, note, context });
          return { confirmed: recordId };
        }
      });
    },
    actions: {
      confirm: {
        input: confirmInput,
        permission: { require: "all", permissions: ["books.confirm"] },
        execute({ service, input, context }) {
          return service.confirmBook(input.recordId, { note: input.note, context });
        },
        route: {
          method: "POST",
          path: "/:recordId/confirm",
          contract: {
            params: schemaDefinition({ recordId: { type: "string", required: true } }),
            body: schemaDefinition({ note: { type: "string", required: false } })
          },
          statusCode: 202,
          summary: "Confirm a book."
        }
      }
    }
  });
  let actions;
  let books;
  const observer = defineProvider({
    id: "test.custom-action-observer",
    requires: { actions: "runtime.actions", books: "crud.books" },
    setup(dependencies) {
      actions = dependencies.actions;
      books = dependencies.books;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, ...createFeatureDependencies(routes), feature, observer]
  });

  await runtime.start();
  assert.equal(typeof books.service.confirmBook, "function");
  const definition = actions.getDefinition("crud.books.confirm");
  assert.deepEqual(definition.permission.permissions, ["books.confirm"]);
  assert.equal(routes.at(-1).method, "POST");
  assert.equal(routes.at(-1).path, "/api/books/:recordId/confirm");
  assert.equal(routes.at(-1).contract.meta.summary, "Confirm a book.");

  const reply = {
    code(statusCode) { this.statusCode = statusCode; return this; },
    send(payload) { this.payload = payload; return this; }
  };
  const routeCalls = [];
  await routes.at(-1).handler({
    input: { params: { recordId: "42" }, body: { note: "Ready" } },
    executeAction(payload) {
      routeCalls.push(payload);
      return { confirmed: "42" };
    }
  }, reply);
  assert.deepEqual(routeCalls, [{
    actionId: "crud.books.confirm",
    input: { recordId: "42", note: "Ready" }
  }]);
  assert.equal(reply.statusCode, 202);
  assert.deepEqual(reply.payload, { confirmed: "42" });

  const context = {
    actor: { id: "tester" },
    permissions: ["books.confirm"],
    surface: "app",
    channel: "internal"
  };
  assert.deepEqual(
    await actions.execute({
      actionId: "crud.books.confirm",
      input: { recordId: "42", note: "Ready" },
      context
    }),
    { confirmed: "42" }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].recordId, "42");
  assert.equal(calls[0].note, "Ready");
  assert.equal(calls[0].context.actor.id, "tester");
  assert.deepEqual(calls[0].context.permissions, ["books.confirm"]);
  await runtime.shutdown();
});

test("defineCrudFeature rejects implicit workspace scope and public private ownership", () => {
  assert.throws(
    () => defineCrudFeature({
      crud: createBookResource(),
      surface: "app",
      routes: "sometimes"
    }),
    /routes must be a boolean/u
  );
  assert.throws(
    () => defineCrudFeature({
      crud: createBookResource({ ownership: "workspace" }),
      surface: "app"
    }),
    /requires explicit scope routeBase, actionInputValidator, routeParamsValidator, inputKeys, input/u
  );
  assert.throws(
    () => defineCrudFeature({
      crud: createBookResource({ apiAccess: "public", ownership: "user" }),
      surface: "public"
    }),
    /public CRUD feature serves a table resource whose ownership \(or visibility\) is "public"/u
  );
  assert.throws(
    () => defineCrudFeature({
      crud: createBookResource(),
      surface: "app",
      operationLifecycle: { list: { afterCommit() {} } }
    }),
    /afterCommit is only valid for mutations/u
  );
  assert.throws(
    () => defineCrudFeature({
      crud: createBookResource(),
      surface: "app",
      operationLifecycle: { update: { eventually() {} } }
    }),
    /unknown phase "eventually"/u
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
    crudJsonApiRouteOptions({
      namespace: "books",
      resource: createBookResource({ ownership: "workspace" }),
      routeBase: "/w/:workspaceSlug",
      relativePath: "/books",
      surface: "app",
      ownershipFilter: "workspace",
      access: "authenticated",
      scopeInput: (request) => ({ workspaceSlug: request.input.params.workspaceSlug })
    })
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
