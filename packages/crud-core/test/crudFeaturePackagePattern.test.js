import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import knexLib from "knex";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { bookCrud, bookResource } from "../patterns/crud-feature-package/example/packages/books/src/shared/bookResource.js";

const providerPath = new URL(
  "../patterns/crud-feature-package/example/packages/books/src/server/BooksFeature.js",
  import.meta.url
);

test("CRUD feature package pattern leaves repetition in the framework", async () => {
  const providerSource = await readFile(providerPath, "utf8");

  assert.equal(bookCrud.namespace, "books");
  assert.equal(bookCrud.resource, bookResource);
  assert.equal(bookResource.tableName, "books");
  assert.equal(bookResource.ownership, "user");
  assert.match(providerSource, /defineCrudFeature/u);
  assert.doesNotMatch(providerSource, /app\.singleton|app\.service|router\.register|createRepository/u);
  assert.doesNotMatch(providerSource, /generator|scaffold|receipt|provenance/u);
});

test("the pattern's books resource is owned and creates a book, its timestamps in whole seconds as declared", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("books", (table) => {
    table.increments("id");
    table.integer("user_id").notNullable();
    table.string("title").notNullable();
    table.string("author").notNullable();
    table.text("notes");
    table.string("created_at").notNullable();
    table.string("updated_at").notNullable();
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { books } = await runtime.own("app.books", [bookResource]);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-08T01:00:00.789Z") });

  // A signed-in request on a user route: the actor, and the user whose rows the route reaches.
  const context = { actor: { id: "7" }, visibilityContext: { visibility: "user", scopeOwnerId: "7", userId: "7" } };
  const book = await books.create({ title: "Kindred", author: "Octavia E. Butler" }, { context });
  assert.equal(book.title, "Kindred");
  assert.deepEqual(await knex("books").first("user_id", "created_at", "updated_at"), {
    user_id: 7,
    created_at: "2026-11-08 01:00:00.000",
    updated_at: "2026-11-08 01:00:00.000"
  });
});
