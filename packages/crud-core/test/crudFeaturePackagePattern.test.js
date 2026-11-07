import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
