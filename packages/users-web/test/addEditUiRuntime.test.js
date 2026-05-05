import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { createAddEditUiRuntime } from "../src/client/composables/runtime/addEditUiRuntime.js";

test("createAddEditUiRuntime resolves api/list/cancel paths from route params", () => {
  const runtime = createAddEditUiRuntime({
    recordIdParam: "addressId",
    routeParams: ref({
      contactId: "7",
      addressId: "42"
    }),
    routePath: ref("/contacts/7/addresses/new"),
    apiUrlTemplate: "/crud/contacts/:contactId/addresses/:addressId",
    viewUrlTemplate: "../:addressId",
    listUrlTemplate: ".."
  });

  assert.equal(runtime.recordId.value, "42");
  assert.equal(runtime.apiSuffix.value, "/crud/contacts/7/addresses/42");
  assert.equal(runtime.listUrl.value, "/contacts/7/addresses");
  assert.equal(runtime.cancelUrl.value, "/contacts/7/addresses/42");
  assert.equal(runtime.resolveParams("../:addressId"), "/contacts/7/addresses/42");
});

test("createAddEditUiRuntime resolves view urls for saved payload ids with nested params", () => {
  const runtime = createAddEditUiRuntime({
    recordIdParam: "addressId",
    routeParams: ref({
      contactId: "7"
    }),
    viewUrlTemplate: "/contacts/:contactId/addresses/:addressId"
  });

  assert.equal(runtime.resolveSavedViewUrl({ id: 99 }), "/contacts/7/addresses/99");
});

test("createAddEditUiRuntime keeps nested child routes stable when the saved child id matches a parent id", () => {
  const runtime = createAddEditUiRuntime({
    recordIdParam: "addressId",
    routeParams: ref({
      workspaceSlug: "tonymobily",
      contactId: "1"
    }),
    routeParamNames: ref(["workspaceSlug", "contactId"]),
    routePath: ref("/w/tonymobily/admin/contacts/1/addresses/new"),
    viewUrlTemplate: "../:addressId",
    listUrlTemplate: ".."
  });

  assert.equal(runtime.listUrl.value, "/w/tonymobily/admin/contacts/1/addresses");
  assert.equal(runtime.resolveSavedViewUrl({ id: 1 }), "/w/tonymobily/admin/contacts/1/addresses/1");
});

test("createAddEditUiRuntime resolves edit-page relative list and cancel links", () => {
  const runtime = createAddEditUiRuntime({
    recordIdParam: "addressId",
    routeParams: ref({
      contactId: "7",
      addressId: "42"
    }),
    routePath: ref("/contacts/7/addresses/42/edit"),
    viewUrlTemplate: "..",
    listUrlTemplate: "../.."
  });

  assert.equal(runtime.listUrl.value, "/contacts/7/addresses");
  assert.equal(runtime.cancelUrl.value, "/contacts/7/addresses/42");
});

test("createAddEditUiRuntime resolves nested edit links from the record scope", () => {
  const runtime = createAddEditUiRuntime({
    recordIdParam: "petId",
    routeParams: ref({
      workspaceSlug: "dogandgroom",
      contactId: "541841",
      petId: "715528"
    }),
    routeParamNames: ref(["workspaceSlug", "contactId", "petId"]),
    routePath: ref("/w/dogandgroom/admin/contacts/541841/pets/715528/edit/advanced"),
    viewUrlTemplate: "..",
    listUrlTemplate: "../.."
  });

  assert.equal(runtime.cancelUrl.value, "/w/dogandgroom/admin/contacts/541841/pets/715528");
  assert.equal(runtime.listUrl.value, "/w/dogandgroom/admin/contacts/541841/pets");
});

test("createAddEditUiRuntime supports custom saved-record selector", () => {
  const runtime = createAddEditUiRuntime({
    recordIdParam: "addressId",
    routeParams: ref({
      contactId: "7"
    }),
    viewUrlTemplate: "/contacts/:contactId/addresses/:addressId",
    saveRecordIdSelector: (payload = {}) => payload.uuid
  });

  assert.equal(runtime.resolveSavedViewUrl({ uuid: "abc-123" }), "/contacts/7/addresses/abc-123");
});

test("createAddEditUiRuntime validates route parameter names", () => {
  assert.throws(
    () =>
      createAddEditUiRuntime({
        recordIdParam: "record-id"
      }),
    /recordIdParam "record-id" is invalid/
  );
});
