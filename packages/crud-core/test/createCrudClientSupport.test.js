import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCrudClientConfig,
  crudScopeQueryKey,
  invalidateCrudQueries,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId,
  resolveCrudRecordChangedEvent,
  normalizeCrudRouteParamName,
  resolveCrudRecordPathTemplates,
  resolveCrudRecordPathParams
} from "../src/client/composables/crudClientSupportHelpers.js";

test("resolveCrudClientConfig normalizes namespace, ownership filter, and resolves route/api paths", () => {
  const config = resolveCrudClientConfig({
    namespace: " Customers ",
    ownershipFilter: "workspace",
    relativePath: "/ops/customers-ui",
    apiRelativePath: "/crud/customers"
  });

  assert.deepEqual(config, {
    namespace: "customers",
    ownershipFilter: "workspace",
    relativePath: "/ops/customers-ui",
    apiRelativePath: "/crud/customers"
  });
});

test("resolveCrudClientConfig infers default relativePath from namespace", () => {
  const config = resolveCrudClientConfig({
    namespace: "appointments",
    ownershipFilter: "public"
  });

  assert.equal(config.relativePath, "/appointments");
  assert.equal(config.apiRelativePath, "/appointments");
});

test("resolveCrudClientConfig throws when namespace is missing", () => {
  assert.throws(
    () => resolveCrudClientConfig({ ownershipFilter: "workspace" }),
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
    "12"
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
  assert.equal(toRouteRecordId("42"), "42");
  assert.equal(toRouteRecordId(["7"]), "7");
  assert.equal(toRouteRecordId("not-a-number"), "");
});

test("normalizeCrudRouteParamName validates route parameter names", () => {
  assert.equal(normalizeCrudRouteParamName("recordId"), "recordId");
  assert.equal(normalizeCrudRouteParamName("addressId"), "addressId");
  assert.throws(
    () => normalizeCrudRouteParamName(""),
    /requires a non-empty route parameter name/
  );
  assert.throws(
    () => normalizeCrudRouteParamName("address-id"),
    /route parameter "address-id" is invalid/
  );
});

test("resolveCrudRecordPathTemplates supports custom route parameter names", () => {
  assert.deepEqual(
    resolveCrudRecordPathTemplates("/users/:userId/addresses", "addressId"),
    {
      viewPathTemplate: "/users/:userId/addresses/:addressId",
      editPathTemplate: "/users/:userId/addresses/:addressId/edit"
    }
  );
});

test("resolveCrudRecordPathParams maps record ids to selected route parameter names", () => {
  assert.deepEqual(resolveCrudRecordPathParams("42", "addressId"), { addressId: "42" });
  assert.deepEqual(resolveCrudRecordPathParams("7", "recordId"), { recordId: "7" });
  assert.deepEqual(resolveCrudRecordPathParams("invalid", "addressId"), {});
});

test("resolveCrudRecordChangedEvent normalizes namespace into event channel", () => {
  assert.equal(resolveCrudRecordChangedEvent("Customers"), "customers.record.changed");
  assert.equal(resolveCrudRecordChangedEvent("customer-orders"), "customer_orders.record.changed");
});
