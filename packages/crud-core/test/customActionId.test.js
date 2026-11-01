import assert from "node:assert/strict";
import test from "node:test";

import { buildCrudCustomActionId } from "../src/server/jsonApiModule/customActionId.js";

test("a CRUD custom action's id defaults to crud.<namespace>.<name>, as the built-in operations' ids", () => {
  assert.equal(buildCrudCustomActionId("books", "confirm", {}), "crud.books.confirm");
});

test("a CRUD custom action's explicit id is kept, trimmed", () => {
  assert.equal(buildCrudCustomActionId("books", "confirm", { id: " books.confirmed " }), "books.confirmed");
});
