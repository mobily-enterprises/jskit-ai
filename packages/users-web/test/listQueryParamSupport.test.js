import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import {
  normalizeListSyncToRouteConfig,
  resolveQueryParamDescriptors,
  resolveActiveQueryParamEntries,
  resolveWritableQueryParamBindings,
  buildQueryParamEntriesToken,
  parseRouteBindingValue,
  areQueryParamBindingValuesEqual,
  buildRouteQueryCompareToken,
  mergeManagedQueryParamKeyHistory,
  resolveRouteSyncManagedKeys
} from "../src/client/composables/listQueryParamSupport.js";

test("normalizeListSyncToRouteConfig defaults", () => {
  assert.deepEqual(
    normalizeListSyncToRouteConfig(false, {
      defaultSearchParam: "search"
    }),
    {
      enabled: false,
      mode: "replace",
      syncSearch: false,
      syncQueryParams: false,
      hydrateFromRoute: false,
      searchParam: "search"
    }
  );

  assert.deepEqual(
    normalizeListSyncToRouteConfig(true),
    {
      enabled: true,
      mode: "replace",
      syncSearch: true,
      syncQueryParams: true,
      hydrateFromRoute: true,
      searchParam: "q"
    }
  );
});

test("resolveQueryParamDescriptors keeps declared keys and supports writable bindings", () => {
  const source = {
    " status ": ref("open"),
    " count ": 2,
    includeArchived: ref(false),
    empty: ""
  };

  const descriptors = resolveQueryParamDescriptors(source);
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.key),
    ["count", "empty", "includeArchived", "status"]
  );

  const activeEntries = resolveActiveQueryParamEntries(descriptors);
  assert.deepEqual(
    activeEntries,
    [
      {
        key: "count",
        values: ["2"]
      },
      {
        key: "status",
        values: ["open"]
      }
    ]
  );

  const bindings = resolveWritableQueryParamBindings(descriptors);
  const countBinding = bindings.find((binding) => binding.key === "count");
  assert.ok(countBinding);
  countBinding.set(9);
  assert.equal(source[" count "], 9);
  assert.equal(source.count, undefined);
});

test("buildQueryParamEntriesToken and compare token stay deterministic", () => {
  assert.equal(
    buildQueryParamEntriesToken([
      {
        key: "status",
        values: ["open"]
      },
      {
        key: "tags",
        values: ["a", "b"]
      }
    ]),
    "status=open&tags=a,b"
  );

  assert.equal(
    buildRouteQueryCompareToken({
      b: "2",
      a: ["1"]
    }),
    buildRouteQueryCompareToken({
      a: "1",
      b: ["2"]
    })
  );
});

test("parseRouteBindingValue handles boolean, number and array bindings", () => {
  const booleanBinding = {
    valueType: "boolean",
    get: () => false
  };
  assert.equal(parseRouteBindingValue(booleanBinding, "1"), true);
  assert.equal(parseRouteBindingValue(booleanBinding, undefined), false);

  const numberBinding = {
    valueType: "number",
    get: () => 7
  };
  assert.equal(parseRouteBindingValue(numberBinding, "12"), 12);
  assert.equal(parseRouteBindingValue(numberBinding, "bad"), 7);
  assert.equal(parseRouteBindingValue(numberBinding, undefined), null);

  const arrayBinding = {
    valueType: "array",
    arrayItemType: "number",
    get: () => []
  };
  assert.deepEqual(
    parseRouteBindingValue(arrayBinding, ["1", "bad", "3"]),
    [1, 3]
  );
});

test("route sync key helpers preserve declared key history for cleanup", () => {
  const history = mergeManagedQueryParamKeyHistory(
    ["status"],
    ["assignee", "status"]
  );
  assert.deepEqual(history, ["assignee", "status"]);

  assert.deepEqual(
    resolveRouteSyncManagedKeys({
      searchEnabled: true,
      searchParam: "q",
      syncSearch: true,
      syncQueryParams: true,
      declaredKeys: ["status"],
      keyHistory: ["assignee"]
    }),
    ["assignee", "q", "status"]
  );
});

test("areQueryParamBindingValuesEqual handles arrays and dates", () => {
  assert.equal(
    areQueryParamBindingValuesEqual([1, 2], [1, 2]),
    true
  );
  assert.equal(
    areQueryParamBindingValuesEqual([1, 2], [2, 1]),
    false
  );
  assert.equal(
    areQueryParamBindingValuesEqual(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:00.000Z")
    ),
    true
  );
});
