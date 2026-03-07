import assert from "node:assert/strict";
import test from "node:test";

import { createPaginationQuerySchema } from "../src/shared/contracts/paginationQuery.js";

test("createPaginationQuerySchema uses expected defaults", () => {
  const schema = createPaginationQuerySchema();

  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.page.minimum, 1);
  assert.equal(schema.properties.page.default, 1);
  assert.equal(schema.properties.pageSize.minimum, 1);
  assert.equal(schema.properties.pageSize.maximum, 100);
  assert.equal(schema.properties.pageSize.default, 10);
});

test("createPaginationQuerySchema applies custom bounds and defaults", () => {
  const schema = createPaginationQuerySchema({
    defaultPage: 2,
    defaultPageSize: 25,
    minPage: 2,
    minPageSize: 5,
    maxPageSize: 250
  });

  assert.equal(schema.properties.page.minimum, 2);
  assert.equal(schema.properties.page.default, 2);
  assert.equal(schema.properties.pageSize.minimum, 5);
  assert.equal(schema.properties.pageSize.maximum, 250);
  assert.equal(schema.properties.pageSize.default, 25);
});
