import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import {
  createJsonRestApiHost,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { createCrudJsonApiActions } from "../src/server/jsonApiModule/actions.js";
import { crudJsonApiActionOptions } from "./support/crudJsonApiActionOptions.js";
import { createCrudJsonApiRepository } from "../src/server/jsonApiModule/repository.js";
import { createCrudJsonApiService } from "../src/server/jsonApiModule/service.js";

function deadlockVictim() {
  return Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), {
    code: "ER_LOCK_DEADLOCK",
    errno: 1213
  });
}

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
  const api = await createJsonRestApiHost({ knex, logger: silentLogger });
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

test("a deadlock victim's repository transaction runs again and commits its writes once", async (t) => {
  const { knex, repository } = await createDatabaseRepository(t);
  let attempts = 0;
  const document = await repository.withTransaction(async (trx) => {
    attempts += 1;
    const created = await repository.createDocument({ title: "Dune" }, { trx });
    await trx("audit_entries").insert({ message: `Attempt ${attempts}` });
    if (attempts === 1) {
      throw deadlockVictim();
    }
    return created;
  });
  assert.equal(attempts, 2);
  assert.equal(document.data.attributes.title, "Dune");
  assert.deepEqual(await knex("books").pluck("title"), ["Dune"]);
  assert.deepEqual(await knex("audit_entries").pluck("message"), ["Attempt 2"]);
});

test("a write that owns its transaction runs again after a deadlock; one in a caller's transaction does not", async () => {
  let posts = 0;
  const api = {
    resources: {
      books: {
        async post() {
          posts += 1;
          if (posts === 1) {
            throw deadlockVictim();
          }
          return { data: { type: "books", id: String(posts) } };
        }
      }
    }
  };
  const repository = createCrudJsonApiRepository({ api, resource: { schema: {} }, resourceScopeName: "books" });
  assert.equal((await repository.createDocument({ title: "Dune" })).data.id, "2");
  posts = 0;
  await assert.rejects(repository.createDocument({ title: "Dune" }, { trx: "managed" }), { code: "ER_LOCK_DEADLOCK" });
  assert.equal(posts, 1);
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
  const actions = createCrudJsonApiActions(crudJsonApiActionOptions({
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
  }));
  await assert.rejects(
    () => actions[0].execute({ recordId: book.data.id, title: "Kindred" }, {}),
    (error) => error.transactionOutcome === "committed" && error.cause === failure
  );
  assert.equal((await knex("books").where({ id: book.data.id }).first()).title, "Kindred");
});

async function createLockedNotesRepository(t, { lockVersionField = "lockVersion" } = {}) {
  const knex = knexLib({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true
  });
  t.after(() => knex.destroy());
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.integer("workspace_id").notNullable();
    table.string("title").notNullable();
    table.integer("lock_version").notNullable().defaultTo(0);
  });
  await knex.schema.createTable("audit_entries", (table) => {
    table.increments("id");
    table.string("message").notNullable();
  });
  await knex("notes").insert([
    { workspace_id: 1, title: "Dune", lock_version: 3 },
    { workspace_id: 2, title: "Kindred", lock_version: 0 }
  ]);
  const resource = defineCrudResource({
    namespace: "notes",
    tableName: "notes",
    autofilter: "workspace",
    lockVersionField,
    schema: {
      workspaceId: { type: "id", required: true, hidden: true, column: "workspace_id" },
      title: { type: "string", required: true },
      lockVersion: { type: "integer", min: 0, readOnly: true, column: "lock_version" }
    }
  });
  const api = await createJsonRestApiHost({ knex, logger: silentLogger });
  await api.addResource("notes", createJsonRestResourceScopeOptions(resource));
  const repository = createCrudJsonApiRepository({ api, resource, resourceScopeName: "notes" });
  const stored = (id) => knex("notes").where({ id }).first("title", "lock_version");
  return { knex, repository, stored };
}

const WORKSPACE_ONE = Object.freeze({ context: Object.freeze({ scopeValues: Object.freeze({ workspaceId: "1" }) }) });

test("a patch at the record's lock version applies and moves the lock version on by one", async (t) => {
  const { repository, stored } = await createLockedNotesRepository(t);
  const document = await repository.patchDocumentIfLockVersion("1", 3, { title: "Dune Messiah" }, WORKSPACE_ONE);
  assert.equal(document.data.attributes.title, "Dune Messiah");
  assert.equal(document.data.attributes.lockVersion, 4);
  assert.deepEqual(await stored(1), { title: "Dune Messiah", lock_version: 4 });
  assert.equal((await repository.patchDocumentIfLockVersion("1", 4, {}, WORKSPACE_ONE)).data.attributes.lockVersion, 5);
});

test("a patch at a stale lock version rejects with a lock version conflict and changes nothing", async (t) => {
  const { repository, stored } = await createLockedNotesRepository(t);
  await assert.rejects(
    () => repository.patchDocumentIfLockVersion("1", 2, { title: "Dune Messiah" }, WORKSPACE_ONE),
    (error) => error.status === 409 && error.code === "crud.document.lockVersionConflict" &&
      error.message === "This record changed. Reload and try again."
  );
  assert.deepEqual(await stored(1), { title: "Dune", lock_version: 3 });
});

test("a record that is missing or out of scope patches to null and keeps its lock version", async (t) => {
  const { repository, stored } = await createLockedNotesRepository(t);
  assert.equal(await repository.patchDocumentIfLockVersion("2", 0, { title: "Fledgling" }, WORKSPACE_ONE), null);
  assert.equal(await repository.patchDocumentIfLockVersion("9", 0, { title: "Fledgling" }, WORKSPACE_ONE), null);
  assert.deepEqual(await stored(2), { title: "Kindred", lock_version: 0 });
});

test("a lock-version patch joins the caller's transaction and rolls back with it", async (t) => {
  const { knex, repository, stored } = await createLockedNotesRepository(t);
  await assert.rejects(() => repository.withTransaction(async (trx) => {
    await repository.patchDocumentIfLockVersion("1", 3, { title: "Dune Messiah" }, { ...WORKSPACE_ONE, trx });
    await trx("audit_entries").insert({ message: "Renamed" });
    assert.deepEqual(await trx("notes").where({ id: 1 }).first("title", "lock_version"), { title: "Dune Messiah", lock_version: 4 });
    throw new Error("Abandon the rename");
  }), /Abandon the rename/);
  assert.deepEqual(await stored(1), { title: "Dune", lock_version: 3 });
  assert.deepEqual(await knex("audit_entries"), []);
  await repository.withTransaction((trx) => repository.patchDocumentIfLockVersion("1", 3, { title: "Dune Messiah" }, { ...WORKSPACE_ONE, trx }));
  assert.deepEqual(await stored(1), { title: "Dune Messiah", lock_version: 4 });
});

test("patchDocumentIfLockVersion needs a lockVersionField, a whole expected version and a patch without the lock", async (t) => {
  const { repository } = await createLockedNotesRepository(t);
  const unlocked = createCrudJsonApiRepository({
    api: { resources: {} },
    resource: { schema: {} },
    resourceScopeName: "notes"
  });
  await assert.rejects(() => unlocked.patchDocumentIfLockVersion("1", 0, {}), /needs resource "notes" to name its lockVersionField/);
  for (const expected of [-1, 1.5, "3", null]) {
    await assert.rejects(() => repository.patchDocumentIfLockVersion("1", expected, {}, WORKSPACE_ONE), /must be a non-negative integer/);
  }
  await assert.rejects(
    () => repository.patchDocumentIfLockVersion("1", 3, { lockVersion: 9 }, WORKSPACE_ONE),
    /advances lockVersion itself, so the patch must leave it out/
  );
});
