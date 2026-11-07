import assert from "node:assert/strict";
import test from "node:test";
import { isTableResource } from "../src/shared/tableResource.js";
import { orderResource } from "../patterns/table-resource/example/orderResource.js";

test("the table resource pattern's example is a workspace-owned table resource", () => {
  assert.equal(isTableResource(orderResource), true);
  assert.equal(orderResource.name, "orders");
  assert.equal(orderResource.tableName, "orders");
  assert.equal(orderResource.ownership, "workspace");
  assert.equal(orderResource.lockVersionField, "lockVersion");
  assert.equal(orderResource.schema.status.defaultTo, "open");
  assert.equal(orderResource.schema.customerId.belongsTo, "customers");
  assert.equal(orderResource.schema.customerId.as, "customer");
  assert.deepEqual(orderResource.schema.customerId.relation, { kind: "lookup", namespace: "customers", valueKey: "id" });
});
