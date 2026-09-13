import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import {
  createJsonRestApiHost,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { createCrudJsonApiActions } from "../src/server/jsonApiModule/actions.js";
import { createCrudJsonApiRepository } from "../src/server/jsonApiModule/repository.js";
import { createCrudJsonApiService } from "../src/server/jsonApiModule/service.js";

function createRepositoryRecorder() {
  const calls = [];
  const response = { data: { type: "books", id: "7", attributes: { title: "Dune" } } };
  const resource = {
    schema: {
      title: { type: "string" },
      authorId: { type: "id", belongsTo: "authors", as: "author" }
    }
  };
  const api = { resources: { books: {} }, transaction: (work) => work("managed") };
  for (const method of ["get", "query", "post", "patch", "delete"]) {
    api.resources.books[method] = async (params, context) => {
      calls.push({ method, params, context });
      return response;
    };
  }
  return {
    calls,
    response,
    repository: createCrudJsonApiRepository({ api, resource, resourceScopeName: "books" })
  };
}

test("JSON:API repositories use plain input with explicit document responses", async () => {
  const { repository, calls, response } = createRepositoryRecorder();
  const context = Object.freeze({ scopeValues: Object.freeze({ workspaceId: "2" }) });
  const payload = Object.freeze({ title: "Dune", authorId: 9, data: { edition: 1 } });
  assert.equal(await repository.createDocument(payload, { trx: "managed", context }), response);
  assert.deepEqual(calls[0].params, {
    data: { title: "Dune", author: 9, data: { edition: 1 } },
    returning: "full",
    transaction: "managed",
    format: "jsonapi"
  });
  assert.notEqual(calls[0].context, context);
  assert.notEqual(calls[0].context.scopeValues, context.scopeValues);
  assert.equal(payload.authorId, 9);
  assert.equal(await repository.patchDocumentById("7", { authorId: null }), response);
  assert.deepEqual(calls[1].params, {
    id: "7",
    data: { author: null },
    returning: "full",
    transaction: null,
    format: "jsonapi"
  });
  await assert.rejects(
    () => repository.createDocument({ authorId: "9", author: "10" }),
    /Provide either "authorId" or "author", not both/
  );
  assert.equal(calls.length, 2);
});

test("JSON:API repository reads and empty patches retain their document contract", async () => {
  const { repository, calls, response } = createRepositoryRecorder();
  assert.equal(await repository.queryDocuments({ title: "Dune" }), response);
  assert.equal(await repository.patchDocumentById("7", {}), response);
  assert.equal(await repository.deleteDocumentById("7"), null);
  assert.deepEqual(calls.map(({ method, params }) => ({ method, params })), [
    { method: "query", params: { queryParams: { filters: { title: "Dune" } }, transaction: null, format: "jsonapi" } },
    { method: "get", params: { id: "7", queryParams: {}, transaction: null, format: "jsonapi" } },
    { method: "delete", params: { id: "7", returning: "none", transaction: null, format: "jsonapi" } }
  ]);
  assert.equal(await repository.withTransaction((trx) => trx), "managed");
});

async function createDatabaseRepository(t) {
  const knex = knexLib({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true
  });
  t.after(() => knex.destroy());
  await knex.schema.createTable("books", (table) => {
    table.increments("id");
    table.string("title").notNullable();
  });
  await knex.schema.createTable("audit_entries", (table) => {
    table.increments("id");
    table.string("message").notNullable();
  });
  const api = await createJsonRestApiHost({ knex });
  const resource = { tableName: "books", schema: { title: { type: "string", required: true } } };
  await api.addResource("books", createJsonRestResourceScopeOptions(resource));
  const repository = createCrudJsonApiRepository({ api, resource, resourceScopeName: "books" });
  return { api, knex, repository };
}

test("repository transactions commit resource writes and raw SQL before completion hooks", async (t) => {
  const { api, knex, repository } = await createDatabaseRepository(t);
  const committed = [];
  await api.customize({ hooks: { afterCommit: ({ context }) => committed.push(context.method) } });
  const document = await repository.withTransaction(async (trx) => {
    const first = await repository.createDocument({ title: "Dune" }, { trx });
    await repository.createDocument({ title: "Kindred" }, { trx });
    await trx("audit_entries").insert({ message: "Created books" });
    assert.deepEqual(committed, []);
    return first;
  });
  assert.equal(document.data.attributes.title, "Dune");
  assert.deepEqual(await knex("books").orderBy("id").pluck("title"), ["Dune", "Kindred"]);
  assert.deepEqual(await knex("audit_entries").pluck("message"), ["Created books"]);
  assert.deepEqual(committed, ["post", "post"]);
});

test("repository transactions roll back resource writes and raw SQL after a rejected participant", async (t) => {
  const { knex, repository } = await createDatabaseRepository(t);
  await assert.rejects(
    () => repository.withTransaction(async (trx) => {
      await repository.createDocument({ title: "Dune" }, { trx });
      await trx("audit_entries").insert({ message: "Pending" });
      await repository.createDocument({}, { trx });
    }),
    (error) => error.transactionOutcome === "rolledBack" && error.code === "REST_API_VALIDATION"
  );
  assert.deepEqual(await knex("books"), []);
  assert.deepEqual(await knex("audit_entries"), []);
});

test("a missing write inside a managed transaction cannot become a successful null result", async (t) => {
  const { knex, repository } = await createDatabaseRepository(t);
  await assert.rejects(
    () => repository.withTransaction(async (trx) => {
      await repository.createDocument({ title: "Dune" }, { trx });
      return repository.patchDocumentById("999", { title: "Missing" }, { trx });
    }),
    (error) => error.transactionOutcome === "rolledBack" && error.subtype === "not_found"
  );
  assert.deepEqual(await knex("books"), []);
  assert.equal(await repository.patchDocumentById("999", { title: "Missing" }), null);
});

test("repository writes reject a raw transaction owner without inserting data", async (t) => {
  const { knex, repository } = await createDatabaseRepository(t);
  await knex.transaction(async (trx) => {
    await assert.rejects(
      () => repository.createDocument({ title: "Dune" }, { trx }),
      (error) => error.code === "REST_API_VALIDATION" && error.transactionOutcome === "none"
    );
    assert.deepEqual(await trx("books"), []);
  });
  assert.deepEqual(await knex("books"), []);
});

test("a failing CRUD afterCommit hook reports committed and leaves the actual write stored", async (t) => {
  const { knex, repository } = await createDatabaseRepository(t);
  const book = await repository.createDocument({ title: "Dune" });
  const failure = Object.freeze(new Error("Notification failed"));
  const actions = createCrudJsonApiActions({
    namespace: "books",
    resource: defineCrudResource({
      namespace: "books",
      tableName: "books",
      autofilter: "public",
      schema: {
        title: {
          type: "string",
          required: true,
          operations: { output: { required: true }, create: { required: true }, patch: { required: false } }
        }
      }
    }),
    repository,
    service: createCrudJsonApiService({ repository }),
    surface: "app",
    operations: ["update"],
    permissionForOperation: () => ({ require: "authenticated" }),
    operationLifecycle: { update: { afterCommit() { throw failure; } } }
  });
  await assert.rejects(
    () => actions[0].execute({ recordId: book.data.id, title: "Kindred" }, {}),
    (error) => error.transactionOutcome === "committed" && error.cause === failure
  );
  assert.equal((await knex("books").where({ id: book.data.id }).first()).title, "Kindred");
});
