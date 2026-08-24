import test from "node:test";
import assert from "node:assert/strict";
import { bookResource } from "../patterns/resource-contract/example/bookResource.js";

test("owner-scoped resource pattern is executable framework source", () => {
  assert.equal(bookResource.namespace, "books");
  assert.equal(bookResource.tableName, "books");
  assert.equal(bookResource.apiAccess, "authenticated");
  assert.equal(bookResource.autofilter, "user");
  assert.deepEqual(
    Object.keys(bookResource.operations),
    ["list", "view", "create", "patch", "delete"]
  );
  assert.deepEqual(
    bookResource.operations.create.body.schema.create({
      title: "The Dispossessed",
      author: "Ursula K. Le Guin",
      notes: null
    }).errors,
    {}
  );
  assert.match(
    bookResource.operations.create.body.schema.create({
      author: "Ursula K. Le Guin"
    }).errors.title.message,
    /required/i
  );
});
