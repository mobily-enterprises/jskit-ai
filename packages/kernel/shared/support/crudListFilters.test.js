import assert from "node:assert/strict";
import test from "node:test";
import {
  defineCrudListFilters,
  resolveCrudListFilterQueryKeys,
  resolveCrudListFilterOptionLabel
} from "./crudListFilters.js";

test("defineCrudListFilters normalizes common filter shapes", () => {
  const filters = defineCrudListFilters({
    onlyStaff: {
      type: "flag",
      label: "Staff"
    },
    status: {
      type: "enumMany",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "archived", label: "Archived" }
      ]
    },
    arrivalDate: {
      type: "dateRange",
      label: "Arrival Date"
    },
    weight: {
      type: "numberRange",
      label: "Weight"
    },
    supplierContactId: {
      type: "recordIdMany",
      label: "Supplier",
      lookup: {
        namespace: "contacts"
      }
    }
  });

  assert.deepEqual(filters.onlyStaff, {
    key: "onlyStaff",
    type: "flag",
    label: "Staff",
    queryKey: "onlyStaff",
    options: [],
    lookup: null,
    chipLabel: null,
    ui: null,
    meta: null
  });
  assert.deepEqual(filters.arrivalDate, {
    key: "arrivalDate",
    type: "dateRange",
    label: "Arrival Date",
    fromKey: "arrivalDateFrom",
    toKey: "arrivalDateTo",
    options: [],
    lookup: null,
    chipLabel: null,
    ui: null,
    meta: null
  });
  assert.deepEqual(filters.weight, {
    key: "weight",
    type: "numberRange",
    label: "Weight",
    minKey: "weightMin",
    maxKey: "weightMax",
    options: [],
    lookup: null,
    chipLabel: null,
    ui: null,
    meta: null
  });
  assert.deepEqual(filters.supplierContactId.lookup, {
    namespace: "contacts",
    apiSuffix: "/contacts",
    valueKey: "id"
  });
});

test("defineCrudListFilters uses fixed presence semantics with optional label overrides", () => {
  const filters = defineCrudListFilters({
    locationAssignment: {
      type: "presence",
      label: "Storage",
      options: [
        { value: "present", label: "Assigned" },
        { value: "missing", label: "Unassigned" }
      ]
    }
  });

  assert.deepEqual(filters.locationAssignment.options, [
    { value: "present", label: "Assigned" },
    { value: "missing", label: "Unassigned" }
  ]);
});

test("defineCrudListFilters rejects duplicate query keys", () => {
  assert.throws(
    () => defineCrudListFilters({
      arrivalDate: {
        type: "dateRange",
        label: "Arrival Date"
      },
      arrivalDateFrom: {
        type: "date",
        label: "Arrival Date From"
      }
    }),
    /both use query key "arrivalDateFrom"/
  );
});

test("resolveCrudListFilter helpers expose query keys and option labels", () => {
  const filters = defineCrudListFilters({
    status: {
      type: "enum",
      label: "Status",
      options: [
        { value: "active", label: "Active" }
      ]
    },
    arrivalDate: {
      type: "dateRange",
      label: "Arrival Date"
    }
  });

  assert.deepEqual(resolveCrudListFilterQueryKeys(filters.status), ["status"]);
  assert.deepEqual(resolveCrudListFilterQueryKeys(filters.arrivalDate), ["arrivalDateFrom", "arrivalDateTo"]);
  assert.equal(resolveCrudListFilterOptionLabel(filters.status, "active"), "Active");
  assert.equal(resolveCrudListFilterOptionLabel(filters.status, "missing", { fallback: "Unknown" }), "Unknown");
});
