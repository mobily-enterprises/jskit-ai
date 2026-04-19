import test from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import { compileRouteValidator } from "@jskit-ai/kernel/_testable";
import { cursorPaginationQueryValidator } from "@jskit-ai/kernel/shared/validators";
import { listSearchQueryValidator } from "../src/server/listQueryValidators.js";
import {
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD,
  createCrudListFilters
} from "../src/server/listFilters.js";

test("crud-core exposes createCrudListFilters through the public package export", async () => {
  const module = await import("@jskit-ai/crud-core/server/listFilters");
  assert.equal(typeof module.createCrudListFilters, "function");
  assert.equal(module.CRUD_LIST_FILTER_INVALID_VALUES_REJECT, CRUD_LIST_FILTER_INVALID_VALUES_REJECT);
  assert.equal(module.CRUD_LIST_FILTER_INVALID_VALUES_DISCARD, CRUD_LIST_FILTER_INVALID_VALUES_DISCARD);
});

function createQueryDouble() {
  const calls = [];
  const nestedQuery = {
    where(...args) {
      calls.push(["innerWhere", ...args]);
      return nestedQuery;
    },
    orWhere(...args) {
      calls.push(["innerOrWhere", ...args]);
      return nestedQuery;
    },
    whereNull(...args) {
      calls.push(["innerWhereNull", ...args]);
      return nestedQuery;
    },
    whereNotNull(...args) {
      calls.push(["innerWhereNotNull", ...args]);
      return nestedQuery;
    }
  };

  const query = {
    where(...args) {
      if (args.length === 1 && typeof args[0] === "function") {
        calls.push(["whereGroup"]);
        args[0](nestedQuery);
        return query;
      }

      calls.push(["where", ...args]);
      return query;
    },
    whereIn(...args) {
      calls.push(["whereIn", ...args]);
      return query;
    },
    whereNull(...args) {
      calls.push(["whereNull", ...args]);
      return query;
    },
    whereNotNull(...args) {
      calls.push(["whereNotNull", ...args]);
      return query;
    }
  };

  return {
    query,
    calls
  };
}

test("createCrudListFilters normalizes filters into semantic values", () => {
  const runtime = createCrudListFilters({
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
    supplierContactId: {
      type: "recordIdMany",
      label: "Supplier"
    },
    weight: {
      type: "numberRange",
      label: "Weight"
    }
  });

  const normalized = runtime.normalize({
    onlyStaff: "",
    status: ["active", "ignored", "archived"],
    arrivalDateFrom: "2026-04-01",
    arrivalDateTo: "2026-04-30",
    supplierContactId: ["7", "bad", "4"],
    weightMin: "12.5",
    weightMax: 18
  });

  assert.deepEqual(normalized, {
    onlyStaff: true,
    status: ["active", "archived"],
    arrivalDate: {
      from: "2026-04-01",
      to: "2026-04-30"
    },
    supplierContactId: ["7", "4"],
    weight: {
      min: 12.5,
      max: 18
    }
  });
});

test("createCrudListFilters applies default column filters by type", () => {
  const runtime = createCrudListFilters(
    {
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
      supplierContactId: {
        type: "recordId",
        label: "Supplier"
      },
      arrivalDate: {
        type: "dateRange",
        label: "Arrival Date"
      },
      weight: {
        type: "numberRange",
        label: "Weight"
      },
      locationAssignment: {
        type: "presence",
        label: "Storage"
      }
    },
    {
      columns: {
        onlyStaff: "is_staff",
        status: "status",
        supplierContactId: "supplier_contact_id",
        arrivalDate: "arrival_datetime",
        weight: "weight_received",
        locationAssignment: "location_id"
      }
    }
  );
  const { query, calls } = createQueryDouble();

  runtime.applyQuery(query, {
    onlyStaff: "",
    status: ["active", "archived"],
    supplierContactId: "7",
    arrivalDateFrom: "2026-04-01",
    arrivalDateTo: "2026-04-30",
    weightMin: "12.5",
    weightMax: "18",
    locationAssignment: "missing"
  });

  assert.deepEqual(calls, [
    ["where", "is_staff", true],
    ["whereIn", "status", ["active", "archived"]],
    ["where", "supplier_contact_id", "7"],
    ["where", "arrival_datetime", ">=", "2026-04-01 00:00:00"],
    ["where", "arrival_datetime", "<", "2026-05-01 00:00:00"],
    ["where", "weight_received", ">=", 12.5],
    ["where", "weight_received", "<=", 18],
    ["whereNull", "location_id"]
  ]);
});

test("createCrudListFilters supports custom apply overrides for complex filters", () => {
  const runtime = createCrudListFilters(
    {
      ccp1Status: {
        type: "enumMany",
        label: "CCP1",
        options: [
          { value: "pending", label: "Pending" },
          { value: "passed", label: "Passed" },
          { value: "failed", label: "Failed" }
        ]
      }
    },
    {
      apply: {
        ccp1Status(queryBuilder, values) {
          queryBuilder.where((statusQuery) => {
            if (values.includes("pending")) {
              statusQuery.whereNull("ccp1_passed");
            }
            if (values.includes("failed")) {
              statusQuery.orWhere("ccp1_passed", false);
            }
          });
        }
      }
    }
  );
  const { query, calls } = createQueryDouble();

  runtime.applyQuery(query, {
    ccp1Status: ["pending", "failed"]
  });

  assert.deepEqual(calls, [
    ["whereGroup"],
    ["innerWhereNull", "ccp1_passed"],
    ["innerOrWhere", "ccp1_passed", false]
  ]);
});

test("createCrudListFilters query validator stays mergeable with search and cursor validators", () => {
  const runtime = createCrudListFilters({
    status: {
      type: "enum",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "archived", label: "Archived" }
      ]
    },
    arrivalDate: {
      type: "dateRange",
      label: "Arrival Date"
    }
  });

  const compiled = compileRouteValidator({
    queryValidator: [
      cursorPaginationQueryValidator,
      listSearchQueryValidator,
      runtime.createQueryValidator({
        invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_REJECT
      })
    ]
  });

  assert.deepEqual(compiled.schema.querystring.required || [], []);
});

test("createCrudListFilters requires explicit invalid-value mode for new query validators", () => {
  const runtime = createCrudListFilters({});

  assert.throws(
    () => runtime.createQueryValidator(),
    /invalidValues mode/
  );
});

test("createCrudListFilters reject validator keeps strict filter schemas", () => {
  const runtime = createCrudListFilters({
    arrivalDate: {
      type: "dateRange",
      label: "Arrival Date"
    },
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
    weight: {
      type: "numberRange",
      label: "Weight"
    }
  });

  const validator = runtime.createQueryValidator({
    invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_REJECT
  });

  assert.equal(Check(validator.schema, {
    arrivalDateFrom: "2026-04-01",
    status: ["active"],
    supplierContactId: ["7"],
    weightMin: "12.5"
  }), true);
  assert.equal(Check(validator.schema, {
    arrivalDateFrom: "bad-date"
  }), false);
  assert.equal(Check(validator.schema, {
    status: ["active", "unexpected"]
  }), false);
  assert.equal(Check(validator.schema, {
    supplierContactId: ["7", "bad"]
  }), false);
  assert.equal(Check(validator.schema, {
    weightMin: "bad"
  }), false);
});

test("createCrudListFilters discard validator accepts malformed values and lets normalize drop them", () => {
  const runtime = createCrudListFilters({
    arrivalDate: {
      type: "dateRange",
      label: "Arrival Date"
    },
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
    weight: {
      type: "numberRange",
      label: "Weight"
    }
  });

  const validator = runtime.createQueryValidator({
    invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_DISCARD
  });

  assert.equal(Check(validator.schema, {
    arrivalDateFrom: "bad-date",
    status: ["active", "unexpected"],
    supplierContactId: ["7", "bad"],
    weightMin: "bad"
  }), true);
  assert.deepEqual(validator.normalize({
    arrivalDateFrom: "bad-date",
    arrivalDateTo: "2026-04-30",
    status: ["active", "unexpected"],
    supplierContactId: ["7", "bad"],
    weightMin: "bad"
  }), {
    arrivalDate: {
      to: "2026-04-30"
    },
    status: ["active"],
    supplierContactId: ["7"]
  });
});

test("createCrudListFilters exposes no default query validator alias", () => {
  const runtime = createCrudListFilters({
    arrivalDate: {
      type: "dateRange",
      label: "Arrival Date"
    }
  });

  assert.equal(Object.hasOwn(runtime, "queryValidator"), false);
  assert.equal(runtime.queryValidator, undefined);
});
