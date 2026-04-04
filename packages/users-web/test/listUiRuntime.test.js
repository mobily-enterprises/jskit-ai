import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { createListUiRuntime } from "../src/client/composables/listUiRuntime.js";

test("createListUiRuntime resolves row keys and relative route templates from string record ids", () => {
  const items = ref([{ uuid: "abc 123" }]);
  const runtime = createListUiRuntime({
    items,
    isInitialLoading: ref(false),
    recordIdParam: "contactId",
    recordIdSelector: (item) => item.uuid,
    routePath: ref("/w/acme/admin/contacts"),
    viewUrlTemplate: "./:contactId",
    editUrlTemplate: "./:contactId/edit"
  });

  assert.equal(runtime.actionColumnCount, 2);
  assert.equal(runtime.resolveRowKey(items.value[0], 0), "abc 123");
  assert.equal(runtime.resolveParams("./new"), "/w/acme/admin/contacts/new");
  assert.equal(runtime.resolveViewUrl(items.value[0]), "/w/acme/admin/contacts/abc%20123");
  assert.equal(runtime.resolveEditUrl(items.value[0]), "/w/acme/admin/contacts/abc%20123/edit");
});

test("createListUiRuntime resolves nested route links from the parent list scope", () => {
  const runtime = createListUiRuntime({
    items: ref([{ id: "901" }]),
    isInitialLoading: ref(false),
    recordIdParam: "petId",
    routeParams: ref({
      workspaceSlug: "dogandgroom",
      contactId: "541841",
      petId: "715528"
    }),
    routeParamNames: ref(["workspaceSlug", "contactId", "petId"]),
    routePath: ref("/w/dogandgroom/admin/contacts/541841/pets/715528"),
    viewUrlTemplate: "./:petId",
    editUrlTemplate: "./:petId/edit"
  });

  assert.equal(runtime.resolveParams("./new"), "/w/dogandgroom/admin/contacts/541841/pets/new");
  assert.equal(runtime.resolveViewUrl({ id: "901" }), "/w/dogandgroom/admin/contacts/541841/pets/901");
  assert.equal(runtime.resolveEditUrl({ id: "901" }), "/w/dogandgroom/admin/contacts/541841/pets/901/edit");
});

test("createListUiRuntime resolves templates that depend on existing route params", () => {
  const runtime = createListUiRuntime({
    items: ref([{ id: 42 }]),
    isInitialLoading: ref(false),
    recordIdParam: "addressId",
    recordIdSelector: (item) => item.id,
    routeParams: ref({ contactId: "7" }),
    viewUrlTemplate: "/contacts/:contactId/addresses/:addressId",
    editUrlTemplate: "/contacts/:contactId/addresses/:addressId/edit"
  });

  assert.equal(runtime.resolveViewUrl({ id: 42 }), "/contacts/7/addresses/42");
  assert.equal(runtime.resolveEditUrl({ id: 42 }), "/contacts/7/addresses/42/edit");
});

test("createListUiRuntime returns empty urls and fallback row keys when record id is missing", () => {
  const runtime = createListUiRuntime({
    items: ref([]),
    isInitialLoading: ref(false),
    recordIdParam: "recordId",
    recordIdSelector: () => "",
    viewUrlTemplate: "./:recordId",
    editUrlTemplate: "./:recordId/edit"
  });

  assert.equal(runtime.resolveRowKey({}, 5), "row-5");
  assert.equal(runtime.resolveViewUrl({}), "");
  assert.equal(runtime.resolveEditUrl({}), "");
});

test("createListUiRuntime computes list skeleton state from loading and item count", () => {
  const items = ref([]);
  const isInitialLoading = ref(true);
  const runtime = createListUiRuntime({
    items,
    isInitialLoading
  });

  assert.equal(runtime.showListSkeleton.value, true);
  items.value = [{}];
  assert.equal(runtime.showListSkeleton.value, false);
  items.value = [];
  isInitialLoading.value = false;
  assert.equal(runtime.showListSkeleton.value, false);
});

test("createListUiRuntime validates route parameter names", () => {
  assert.throws(
    () =>
      createListUiRuntime({
        items: ref([]),
        isInitialLoading: ref(false),
        recordIdParam: "record-id"
      }),
    /recordIdParam "record-id" is invalid/
  );
});
