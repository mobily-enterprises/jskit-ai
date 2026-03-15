import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCrudClientConfig,
  crudScopeQueryKey,
  invalidateCrudQueries,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId,
  resolveCrudRecordChangedEvent
} from "../src/client/composables/crudClientSupportHelpers.js";

test("resolveCrudClientConfig normalizes namespace, visibility, and derives relativePath", () => {
  const config = resolveCrudClientConfig({
    namespace: " Customers ",
    visibility: "workspace",
    relativePath: "/crm/customers"
  });

  assert.deepEqual(config, {
    namespace: "customers",
    visibility: "workspace",
    relativePath: "/crm/customers"
  });
});

test("resolveCrudClientConfig infers default relativePath from namespace", () => {
  const config = resolveCrudClientConfig({
    namespace: "appointments",
    visibility: "public"
  });

  assert.equal(config.relativePath, "/appointments");
});

test("resolveCrudClientConfig throws when namespace is missing", () => {
  assert.throws(
    () => resolveCrudClientConfig({ visibility: "workspace" }),
    /requires a non-empty namespace/
  );
});

test("crudListQueryKey and crudViewQueryKey normalize cache keys", () => {
  assert.deepEqual(crudListQueryKey("Admin", " TonymoBily3 ", "Customers"), [
    "crud",
    "customers",
    "list",
    "admin",
    "tonymobily3"
  ]);

  assert.deepEqual(crudViewQueryKey("Admin", " TonymoBily3 ", "12", "Customers"), [
    "crud",
    "customers",
    "view",
    "admin",
    "tonymobily3",
    12
  ]);
});

test("crudScopeQueryKey normalizes namespace", () => {
  assert.deepEqual(crudScopeQueryKey(" Customers "), ["crud", "customers"]);
});

test("invalidateCrudQueries invalidates by CRUD namespace scope key", async () => {
  let payload = null;
  const queryClient = {
    async invalidateQueries(input) {
      payload = input;
      return true;
    }
  };

  await invalidateCrudQueries(queryClient, "Customers");
  assert.deepEqual(payload, {
    queryKey: ["crud", "customers"]
  });
});

test("toRouteRecordId parses scalar and array params safely", () => {
  assert.equal(toRouteRecordId("42"), 42);
  assert.equal(toRouteRecordId(["7"]), 7);
  assert.equal(toRouteRecordId("not-a-number"), 0);
});

test("resolveCrudRecordChangedEvent normalizes namespace into event channel", () => {
  assert.equal(resolveCrudRecordChangedEvent("Customers"), "customers.record.changed");
  assert.equal(resolveCrudRecordChangedEvent("customer-orders"), "customer_orders.record.changed");
});
