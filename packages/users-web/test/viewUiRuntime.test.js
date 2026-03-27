import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { createViewUiRuntime } from "../src/client/composables/viewUiRuntime.js";

test("createViewUiRuntime resolves api/list/edit paths with nested params", () => {
  const runtime = createViewUiRuntime({
    recordIdParam: "addressId",
    routeParams: ref({
      userId: "user-7",
      addressId: "addr-42"
    }),
    routePath: ref("/users/user-7/addresses/addr-42"),
    apiUrlTemplate: "/crud/users/:userId/addresses/:addressId",
    listUrlTemplate: "..",
    editUrlTemplate: "./edit"
  });

  assert.equal(runtime.recordId.value, "addr-42");
  assert.equal(runtime.apiSuffix.value, "/crud/users/user-7/addresses/addr-42");
  assert.equal(runtime.listUrl.value, "/users/user-7/addresses");
  assert.equal(runtime.editUrl.value, "/users/user-7/addresses/addr-42/edit");
  assert.equal(runtime.resolveParams("./edit"), "/users/user-7/addresses/addr-42/edit");
});

test("createViewUiRuntime uses explicit routeRecordId when route params do not include id", () => {
  const runtime = createViewUiRuntime({
    recordIdParam: "addressId",
    routeParams: ref({
      userId: "user-7"
    }),
    routeRecordId: ref("new-id"),
    apiUrlTemplate: "/crud/users/:userId/addresses/:addressId"
  });

  assert.equal(runtime.recordId.value, "new-id");
  assert.equal(runtime.apiSuffix.value, "/crud/users/user-7/addresses/new-id");
});

test("createViewUiRuntime returns empty api suffix when required params are missing", () => {
  const runtime = createViewUiRuntime({
    recordIdParam: "addressId",
    routeParams: ref({
      addressId: "42"
    }),
    apiUrlTemplate: "/crud/users/:userId/addresses/:addressId"
  });

  assert.equal(runtime.apiSuffix.value, "");
});

test("createViewUiRuntime validates route parameter names", () => {
  assert.throws(
    () =>
      createViewUiRuntime({
        recordIdParam: "record-id"
      }),
    /recordIdParam "record-id" is invalid/
  );
});
