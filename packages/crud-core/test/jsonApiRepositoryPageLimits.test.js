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
import { createCrudJsonApiRepository } from "../src/server/jsonApiModule/repository.js";
import { createCrudJsonApiService } from "../src/server/jsonApiModule/service.js";
import { crudJsonApiActionOptions } from "./support/crudJsonApiActionOptions.js";

// 250 notes by 30 authors, in teams "a" and "b", read through json-rest-api's default page cap (100).
async function createFixture(t) {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("authors", (table) => {
    table.increments("id");
    table.string("name").notNullable();
  });
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.integer("author_id").notNullable();
    table.string("team").notNullable();
    table.string("title").notNullable();
  });
  await knex.batchInsert("authors", Array.from({ length: 30 }, (_, index) => ({ name: `Author ${index + 1}` })), 100);
  await knex.batchInsert("notes", Array.from({ length: 250 }, (_, index) => ({
    author_id: (index % 30) + 1,
    team: index % 2 === 0 ? "a" : "b",
    title: `Note ${index + 1}`
  })), 100);

  const authors = defineCrudResource({
    namespace: "authors",
    tableName: "authors",
    schema: { name: { type: "string", required: true } }
  });
  const notes = defineCrudResource({
    namespace: "notes",
    tableName: "notes",
    schema: {
      authorId: { type: "id", required: true, column: "author_id", belongsTo: "authors", as: "author" },
      team: { type: "string", required: true, search: true },
      title: { type: "string", required: true }
    }
  });
  const api = await createJsonRestApiHost({ knex, logger: silentLogger });
  await api.addResource("authors", createJsonRestResourceScopeOptions(authors));
  await api.addResource("notes", createJsonRestResourceScopeOptions(notes));
  return {
    knex,
    resource: notes,
    repository: createCrudJsonApiRepository({ api, resource: notes, resourceScopeName: "notes" })
  };
}

const sortedIds = (rows) => rows.map((row) => Number(row.id)).sort((left, right) => left - right);

test("queryDocuments refuses a limit above queryMaxLimit and names queryEveryDocument", async (t) => {
  const { repository } = await createFixture(t);
  assert.equal(repository.queryMaxLimit(), 100);

  const page = await repository.queryDocuments({ limit: 100 });
  assert.equal(page.data.length, 100);
  assert.equal(page.meta.pagination.hasMore, true);
  assert.equal((await repository.queryDocuments({ limit: "100" })).data.length, 100);

  for (const limit of [101, "250", 500]) {
    await assert.rejects(
      () => repository.queryDocuments({ limit }),
      (error) => error instanceof TypeError &&
        error.message.includes(`limit ${limit} is above its queryMaxLimit (100)`) &&
        error.message.includes("queryEveryDocument(query, options)"),
      `limit ${limit}`
    );
  }
});

test("queryEveryDocument returns every one of 250 records once, each included author once", async (t) => {
  const { repository } = await createFixture(t);

  const document = await repository.queryEveryDocument({ include: ["author"] });

  assert.equal(document.data.length, 250);
  assert.deepEqual(sortedIds(document.data), Array.from({ length: 250 }, (_, index) => index + 1));
  assert.equal(document.included.length, 30);
  assert.equal(new Set(document.included.map(({ type, id }) => `${type}:${id}`)).size, 30);
  assert.ok(document.included.every(({ type }) => type === "authors"));
  assert.deepEqual(document.data[0].relationships.author.data, { type: "authors", id: "1" });

  const teamA = await repository.queryEveryDocument({ team: "a" });
  assert.equal(teamA.data.length, 125);
  assert.ok(teamA.data.every((record) => record.attributes.team === "a"));
  assert.equal(Object.hasOwn(teamA, "included"), false);
});

test("queryEveryDocument reads in the caller's transaction and refuses a limit, cursor or sort", async (t) => {
  const { repository } = await createFixture(t);
  await repository.withTransaction(async (trx) => {
    await trx("notes").insert({ author_id: 1, team: "a", title: "Uncommitted" });
    const document = await repository.queryEveryDocument({ team: "a" }, { trx });
    assert.equal(document.data.length, 126);
    assert.ok(document.data.some((record) => record.attributes.title === "Uncommitted"));
  });

  for (const query of [{ limit: 10 }, { cursor: "abc" }, { sort: ["title"] }]) {
    const [key] = Object.keys(query);
    await assert.rejects(
      () => repository.queryEveryDocument(query),
      (error) => error instanceof TypeError && error.message.includes(`its query cannot name ${key}`),
      key
    );
  }
});

test("the list action keeps answering a larger limit with one capped page", async (t) => {
  const { repository, resource } = await createFixture(t);
  const actions = createCrudJsonApiActions(crudJsonApiActionOptions({
    namespace: "notes",
    resource,
    repository,
    service: createCrudJsonApiService({ repository }),
    surface: "admin",
    operations: ["list"],
    permissionForOperation: () => ({ require: "authenticated" })
  }));
  const list = actions.find((entry) => entry.id.split(".").at(-1) === "list");

  for (const limit of [500, "250", 100]) {
    const result = await list.execute({ limit }, {});
    assert.equal(result.value.data.length, 100, `limit ${limit}`);
    assert.equal(result.value.meta.pagination.pageSize, 100, `limit ${limit}`);
    assert.equal(result.value.meta.pagination.hasMore, true, `limit ${limit}`);
    assert.equal(typeof result.value.meta.pagination.cursor.next, "string");
  }
  assert.equal((await list.execute({ limit: 20 }, {})).value.data.length, 20);
});
