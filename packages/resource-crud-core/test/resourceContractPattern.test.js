import test from "node:test";
import assert from "node:assert/strict";
import { bookCrud, bookResource } from "../patterns/resource-contract/example/bookResource.js";

test("owner-scoped table resource and CRUD contract pattern is executable framework source", () => {
  assert.equal(bookResource.name, "books");
  assert.equal(bookResource.tableName, "books");
  assert.equal(bookResource.ownership, "user");
  assert.equal(bookCrud.resource, bookResource);
  assert.equal(bookCrud.namespace, "books");
  assert.equal(bookCrud.apiAccess, "authenticated");
  assert.deepEqual(
    Object.keys(bookCrud.operations),
    ["list", "view", "create", "patch", "delete"]
  );
  assert.deepEqual(
    bookCrud.operations.create.body.schema.create({
      title: "The Dispossessed",
      author: "Ursula K. Le Guin",
      notes: null
    }).errors,
    {}
  );
  assert.match(
    bookCrud.operations.create.body.schema.create({
      author: "Ursula K. Le Guin"
    }).errors.title.message,
    /required/i
  );
});
