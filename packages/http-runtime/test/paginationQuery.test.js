import assert from "node:assert/strict";
import test from "node:test";

import { createPaginationQuerySchema } from "../src/shared/validators/paginationQuery.js";

test("createPaginationQuerySchema exports the expected transport bounds", () => {
  const schema = createPaginationQuerySchema().toJsonSchema({ mode: "patch" });

  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.page.minimum, 1);
  assert.equal(schema.properties.pageSize.minimum, 1);
  assert.equal(schema.properties.pageSize.maximum, 100);
});

test("createPaginationQuerySchema applies custom transport bounds", () => {
  const schema = createPaginationQuerySchema({
    defaultPage: 2,
    defaultPageSize: 25,
    minPage: 2,
    minPageSize: 5,
    maxPageSize: 250
  }).toJsonSchema({ mode: "patch" });

  assert.equal(schema.properties.page.minimum, 2);
  assert.equal(schema.properties.pageSize.minimum, 5);
  assert.equal(schema.properties.pageSize.maximum, 250);
});
