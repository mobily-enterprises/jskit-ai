import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCrudClientConfig,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId
} from "../src/client/composables/crudClientSupportHelpers.js";

test("resolveCrudClientConfig normalizes namespace, visibility, and relativePath", () => {
  const config = resolveCrudClientConfig({
    namespace: " Customers ",
    visibility: "workspace",
    relativePath: "crm/customers/"
  });

  assert.deepEqual(config, {
    namespace: "customers",
    visibility: "workspace",
    workspaceScoped: true,
    relativePath: "/crm/customers"
  });
});

test("resolveCrudClientConfig infers default relativePath from namespace", () => {
  const config = resolveCrudClientConfig({
    namespace: "appointments",
    visibility: "public"
  });

  assert.equal(config.relativePath, "/appointments");
  assert.equal(config.workspaceScoped, false);
});

test("crudListQueryKey and crudViewQueryKey normalize cache keys", () => {
  assert.deepEqual(crudListQueryKey("Admin", " TonymoBily3 ", "Customers"), [
    "crud",
    "crud",
    "customers",
    "list",
    "admin",
    "tonymobily3"
  ]);

  assert.deepEqual(crudViewQueryKey("Admin", " TonymoBily3 ", "12", "Customers"), [
    "crud",
    "crud",
    "customers",
    "view",
    "admin",
    "tonymobily3",
    12
  ]);
});

test("toRouteRecordId parses scalar and array params safely", () => {
  assert.equal(toRouteRecordId("42"), 42);
  assert.equal(toRouteRecordId(["7"]), 7);
  assert.equal(toRouteRecordId("not-a-number"), 0);
});
