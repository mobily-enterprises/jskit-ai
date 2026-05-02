import assert from "node:assert/strict";
import test from "node:test";
import {
  defineCrudListFilters,
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD,
  INVALID_CRUD_LIST_FILTER_QUERY_VALUE,
  parseCrudListRangeQueryExpression,
  formatCrudListRangeQueryExpression,
  createCrudListFilterInitialValue,
  isCrudListFilterMultiValue,
  isCrudListFilterStructuredValue,
  normalizeCrudListFilterUiValue,
  areCrudListFilterUiValuesEqual,
  hasCrudListFilterUiValue,
  listCrudListFilterChipValues,
  formatCrudListFilterDefaultChipLabel,
  formatCrudListFilterQueryValue,
  parseCrudListFilterQueryValue,
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
    queryKey: "arrivalDate",
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
    queryKey: "weight",
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
      arrivalDateExact: {
        type: "date",
        label: "Arrival Date From",
        queryKey: "arrivalDate"
      }
    }),
    /both use query key "arrivalDate"/
  );
});

test("defineCrudListFilters rejects split range keys", () => {
  assert.throws(
    () => defineCrudListFilters({
      arrivalDate: {
        type: "dateRange",
        label: "Arrival Date",
        fromKey: "arrivalDateFrom"
      }
    }),
    /unsupported split range keys/
  );

  assert.throws(
    () => defineCrudListFilters({
      weight: {
        type: "numberRange",
        label: "Weight",
        minKey: "weightMin"
      }
    }),
    /unsupported split range keys/
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
  assert.deepEqual(resolveCrudListFilterQueryKeys(filters.arrivalDate), ["arrivalDate"]);
  assert.equal(resolveCrudListFilterOptionLabel(filters.status, "active"), "Active");
  assert.equal(resolveCrudListFilterOptionLabel(filters.status, "missing", { fallback: "Unknown" }), "Unknown");
});

test("crud list range helpers parse and format single-key range expressions", () => {
  assert.deepEqual(parseCrudListRangeQueryExpression("2026-04-01"), {
    exact: true,
    start: "2026-04-01",
    end: "2026-04-01"
  });
  assert.deepEqual(parseCrudListRangeQueryExpression("2026-04-01..2026-04-30"), {
    exact: false,
    start: "2026-04-01",
    end: "2026-04-30"
  });
  assert.deepEqual(parseCrudListRangeQueryExpression("..2026-04-30"), {
    exact: false,
    start: "",
    end: "2026-04-30"
  });
  assert.equal(parseCrudListRangeQueryExpression(".."), null);

  assert.equal(formatCrudListRangeQueryExpression("2026-04-01", ""), "2026-04-01..");
  assert.equal(
    formatCrudListRangeQueryExpression("2026-04-01", "2026-04-01", { collapseExact: true }),
    "2026-04-01"
  );
});

test("crud list filter helpers share canonical UI and query normalization", () => {
  const filters = defineCrudListFilters({
    status: {
      type: "enumMany",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "archived", label: "Archived" }
      ]
    },
    supplierContactId: {
      type: "recordIdMany",
      label: "Supplier"
    },
    arrivalDate: {
      type: "dateRange",
      label: "Arrival Date"
    }
  });

  assert.deepEqual(createCrudListFilterInitialValue(filters.status), []);
  assert.equal(isCrudListFilterMultiValue(filters.status), true);
  assert.equal(isCrudListFilterMultiValue(filters.arrivalDate), false);
  assert.equal(isCrudListFilterStructuredValue(filters.arrivalDate), true);
  assert.equal(isCrudListFilterStructuredValue(filters.status), false);
  assert.deepEqual(
    normalizeCrudListFilterUiValue(filters.status, ["active", "unexpected"]),
    ["active"]
  );
  assert.deepEqual(
    parseCrudListFilterQueryValue(filters.status, ["active", "unexpected"], {
      invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_DISCARD
    }),
    ["active"]
  );
  assert.equal(
    parseCrudListFilterQueryValue(filters.status, ["active", "unexpected"], {
      invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_REJECT
    }),
    INVALID_CRUD_LIST_FILTER_QUERY_VALUE
  );

  assert.deepEqual(
    normalizeCrudListFilterUiValue(filters.supplierContactId, ["7", "bad", 4]),
    ["7", "4"]
  );
  assert.deepEqual(
    parseCrudListFilterQueryValue(filters.supplierContactId, ["7", "bad", 4], {
      invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_DISCARD
    }),
    ["7", "4"]
  );
  assert.equal(
    parseCrudListFilterQueryValue(filters.supplierContactId, { bad: true }, {
      invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_REJECT
    }),
    INVALID_CRUD_LIST_FILTER_QUERY_VALUE
  );

  assert.deepEqual(
    normalizeCrudListFilterUiValue(filters.arrivalDate, "..2026-04-30"),
    {
      from: "",
      to: "2026-04-30"
    }
  );
  assert.equal(
    formatCrudListFilterQueryValue(filters.arrivalDate, {
      from: "2026-04-30",
      to: "2026-04-30"
    }),
    "2026-04-30"
  );
  assert.equal(
    areCrudListFilterUiValuesEqual(
      filters.arrivalDate,
      {
        from: "2026-04-30",
        to: "2026-04-30"
      },
      "2026-04-30"
    ),
    true
  );
  assert.equal(hasCrudListFilterUiValue(filters.status, ["active", "unexpected"]), true);
  assert.equal(hasCrudListFilterUiValue(filters.arrivalDate, { from: "", to: "" }), false);
  assert.deepEqual(listCrudListFilterChipValues(filters.status, ["active", "unexpected"]), ["active"]);
  assert.deepEqual(
    listCrudListFilterChipValues(filters.arrivalDate, {
      from: "2026-04-30",
      to: "2026-04-30"
    }),
    [{
      from: "2026-04-30",
      to: "2026-04-30"
    }]
  );
  assert.equal(
    formatCrudListFilterDefaultChipLabel(filters.status, "active", {
      resolveAtomicValue(value) {
        return resolveCrudListFilterOptionLabel(filters.status, value);
      }
    }),
    "Status: Active"
  );
});
