import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bookResource } from "../patterns/json-api-resource-package/example/packages/books/src/shared/bookResource.js";

const providerPath = new URL(
  "../patterns/json-api-resource-package/example/packages/books/src/server/BooksFeature.js",
  import.meta.url
);

test("JSON API resource package pattern leaves repetition in the framework", async () => {
  const providerSource = await readFile(providerPath, "utf8");

  assert.equal(bookResource.namespace, "books");
  assert.equal(bookResource.tableName, "books");
  assert.equal(bookResource.autofilter, "user");
  assert.match(providerSource, /defineCrudJsonApiFeature/u);
  assert.doesNotMatch(providerSource, /app\.singleton|app\.service|router\.register|createRepository/u);
  assert.doesNotMatch(providerSource, /generator|scaffold|receipt|provenance/u);
});
