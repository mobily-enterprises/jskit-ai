import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveLookupSelectedValues,
  createLookupOptionsFromItems,
  mergeSelectedLookupOptions,
  resolveLookupOptionLabel
} from "../src/client/composables/internal/crudListFilterLookupSupport.js";

const supplierFilter = Object.freeze({
  key: "supplierContactId",
  type: "recordIdMany",
  label: "Supplier",
  lookup: Object.freeze({
    apiSuffix: "/contacts",
    valueKey: "id",
    labelKey: "name"
  })
});

test("lookup filter support normalizes selected record ids for single and many filters", () => {
  assert.deepEqual(
    resolveLookupSelectedValues(supplierFilter, ["7", "4", "7", ""]),
    ["7", "4"]
  );

  assert.deepEqual(
    resolveLookupSelectedValues(
      {
        ...supplierFilter,
        type: "recordId"
      },
      12
    ),
    ["12"]
  );
});

test("lookup filter support builds option labels from custom resolvers and fallback lookup labels", () => {
  const options = createLookupOptionsFromItems(
    [
      {
        id: 7,
        firstName: "Pollen",
        lastName: "Partners"
      },
      {
        id: 4,
        name: "Harbor Storage"
      }
    ],
    supplierFilter,
    (item = {}) => {
      if (item.id === 7) {
        return `${item.firstName} ${item.lastName}`;
      }

      return "";
    }
  );

  assert.deepEqual(options, [
    {
      value: "7",
      label: "Pollen Partners",
      record: {
        id: 7,
        firstName: "Pollen",
        lastName: "Partners"
      }
    },
    {
      value: "4",
      label: "Harbor Storage",
      record: {
        id: 4,
        name: "Harbor Storage"
      }
    }
  ]);
});

test("lookup filter support merges cached selected labels and resolves fallback labels", () => {
  const currentOptions = [
    {
      value: "7",
      label: "Pollen Partners",
      record: {
        id: 7,
        name: "Pollen Partners"
      }
    }
  ];
  const cachedOptions = new Map([
    ["12", {
      value: "12",
      label: "North Shed",
      record: {
        id: 12,
        name: "North Shed"
      }
    }]
  ]);

  const mergedOptions = mergeSelectedLookupOptions(
    currentOptions,
    ["12", "7"],
    cachedOptions
  );

  assert.deepEqual(mergedOptions.map((option) => option.value), ["12", "7"]);
  assert.equal(resolveLookupOptionLabel(mergedOptions, cachedOptions, "12", "Storage"), "North Shed");
  assert.equal(resolveLookupOptionLabel(mergedOptions, cachedOptions, "55", "Storage"), "Storage 55");
});
