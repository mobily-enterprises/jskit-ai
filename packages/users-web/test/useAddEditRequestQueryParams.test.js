import assert from "node:assert/strict";
import test from "node:test";
import { computed, reactive, ref, shallowRef } from "vue";
import { createRequestQueryRuntime } from "../src/client/composables/support/requestQueryRuntimeSupport.js";

test("add/edit request query params resolve stable cache tokens and request paths", () => {
  const sourceQueryKey = ref(["products", "dev-admin"]);
  const sourcePath = ref("/api/w/dev-admin/products/product-42");
  const context = ref(Object.freeze({
    surfaceId: "admin",
    scopeParamValue: "dev-admin",
    ownershipFilter: "workspace",
    recordId: "product-42",
    model: {
      status: "draft"
    }
  }));
  const runtime = createRequestQueryRuntime({
    requestQueryParams(callbackContext = {}) {
      assert.deepEqual(callbackContext, context.value);

      return {
        include: "serviceId,bookingSteps,bookingSteps.requiredRoleId",
        preview: callbackContext.model.status === "draft"
      };
    },
    context,
    sourceQueryKey,
    sourcePath
  });

  assert.deepEqual(runtime.activeRequestQueryParamEntries.value, [
    {
      key: "include",
      values: ["serviceId,bookingSteps,bookingSteps.requiredRoleId"]
    },
    {
      key: "preview",
      values: ["1"]
    }
  ]);
  assert.equal(
    runtime.activeRequestQueryParamsToken.value,
    "include=serviceId,bookingSteps,bookingSteps.requiredRoleId&preview=1"
  );
  assert.deepEqual(
    runtime.queryKey.value,
    [
      "products",
      "dev-admin",
      "__request_query__",
      "include=serviceId,bookingSteps,bookingSteps.requiredRoleId&preview=1"
    ]
  );
  assert.equal(
    runtime.requestPath.value,
    "/api/w/dev-admin/products/product-42?include=serviceId%2CbookingSteps%2CbookingSteps.requiredRoleId&preview=1"
  );
});

test("add/edit request query params react to callback context changes", () => {
  const recordId = ref("product-42");
  const model = reactive({
    status: "draft"
  });
  const context = computed(() => Object.freeze({
    surfaceId: "admin",
    scopeParamValue: "dev-admin",
    ownershipFilter: "workspace",
    recordId: recordId.value,
    model
  }));
  const runtime = createRequestQueryRuntime({
    requestQueryParams(callbackContext = {}) {
      return {
        include: "bookingSteps",
        preview: callbackContext.model.status === "draft",
        recordId: callbackContext.recordId
      };
    },
    context,
    sourceQueryKey: computed(() => ["products", context.value.scopeParamValue]),
    sourcePath: computed(() => `/api/w/dev-admin/products/${recordId.value}`)
  });

  assert.deepEqual(
    runtime.queryKey.value,
    [
      "products",
      "dev-admin",
      "__request_query__",
      "include=bookingSteps&preview=1&recordId=product-42"
    ]
  );
  assert.equal(
    runtime.requestPath.value,
    "/api/w/dev-admin/products/product-42?include=bookingSteps&preview=1&recordId=product-42"
  );

  model.status = "published";
  recordId.value = "product-99";

  assert.deepEqual(
    runtime.queryKey.value,
    [
      "products",
      "dev-admin",
      "__request_query__",
      "include=bookingSteps&recordId=product-99"
    ]
  );
  assert.equal(
    runtime.requestPath.value,
    "/api/w/dev-admin/products/product-99?include=bookingSteps&recordId=product-99"
  );
});

test("request query runtime preserves scalar base query keys", () => {
  const runtime = createRequestQueryRuntime({
    requestQueryParams: {
      include: "bookingSteps"
    },
    sourceQueryKey: ref("products"),
    sourcePath: "/api/products/42"
  });

  assert.deepEqual(
    runtime.queryKey.value,
    [
      "products",
      "__request_query__",
      "include=bookingSteps"
    ]
  );
});

test("request query runtime leaves keys and paths unchanged without active request params", () => {
  const sourceQueryKey = ["products"];
  const runtime = createRequestQueryRuntime({
    requestQueryParams: {
      include: "",
      archived: false
    },
    sourceQueryKey: shallowRef(sourceQueryKey),
    sourcePath: "/api/products/42"
  });

  assert.deepEqual(runtime.activeRequestQueryParamEntries.value, []);
  assert.equal(runtime.activeRequestQueryParamsToken.value, "");
  assert.deepEqual(runtime.queryKey.value, ["products"]);
  assert.equal(runtime.queryKey.value, sourceQueryKey);
  assert.equal(runtime.requestPath.value, "/api/products/42");
});

test("request query runtime preserves inactive scalar query keys", () => {
  const runtime = createRequestQueryRuntime({
    requestQueryParams: {
      include: ""
    },
    sourceQueryKey: ref("products"),
    sourcePath: "/api/products/42"
  });

  assert.equal(runtime.queryKey.value, "products");
  assert.equal(runtime.requestPath.value, "/api/products/42");
});
