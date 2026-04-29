import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import { compileRouteValidator } from "@jskit-ai/kernel/_testable";
import {
  composeSchemaDefinitions,
  cursorPaginationQueryValidator
} from "@jskit-ai/kernel/shared/validators";
import { listSearchQueryValidator } from "../src/server/listQueryValidators.js";
import {
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD,
  createCrudListFilters
} from "../src/server/listFilters.js";

function composeSchemaDefinition(...definitions) {
  return composeSchemaDefinitions(definitions, {
    mode: "patch",
    context: "crudCore.listFilters.compose"
  });
}

test("crud-core exposes createCrudListFilters through the public package export", async () => {
  const module = await import("@jskit-ai/crud-core/server/listFilters");
  assert.equal(typeof module.createCrudListFilters, "function");
  assert.equal(module.CRUD_LIST_FILTER_INVALID_VALUES_REJECT, CRUD_LIST_FILTER_INVALID_VALUES_REJECT);
  assert.equal(module.CRUD_LIST_FILTER_INVALID_VALUES_DISCARD, CRUD_LIST_FILTER_INVALID_VALUES_DISCARD);
});

test("importing crud-core list filters does not register a global json-rest-schema type", () => {
  const schema = createSchema({
    status: {
      type: "crudListFilterQuery"
    }
  });

  assert.throws(() => {
    schema.patch({
      status: "active"
    });
  }, /No casting function for type: crudListFilterQuery/);
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
    arrivalDate: "2026-04-01..2026-04-30",
    supplierContactId: ["7", "bad", "4"],
    weight: "12.5..18"
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
    arrivalDate: "2026-04-01..2026-04-30",
    weight: "12.5..18",
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
    query: composeSchemaDefinition(
      cursorPaginationQueryValidator,
      listSearchQueryValidator,
      runtime.createQueryValidator({
        invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_REJECT
      })
    )
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
  const transportSchema = validator.schema.toJsonSchema({
    mode: validator.mode
  });

  assert.equal(transportSchema.type, "object");
  assert.equal(transportSchema.additionalProperties, false);
  assert.equal(
    transportSchema.properties.arrivalDate.pattern,
    "^(?:\\d{4}-\\d{2}-\\d{2}(?:\\.\\.(?:\\d{4}-\\d{2}-\\d{2})?)?|\\.\\.\\d{4}-\\d{2}-\\d{2})$"
  );
  assert.deepEqual(transportSchema.properties.status.anyOf[1].items.enum, ["active", "archived"]);
  assert.equal(transportSchema.properties.supplierContactId.anyOf[1].items.anyOf[0].pattern, "^[1-9][0-9]*$");
  assert.equal(
    transportSchema.properties.weight.anyOf[0].pattern,
    "^(?:[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?(?:\\.\\.(?:[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)?)?|\\.\\.[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)$"
  );
  assert.deepEqual(validator.schema.patch({
    arrivalDate: "2026-04-01..2026-04-30",
    status: ["active", "archived"],
    supplierContactId: ["7", "4"],
    weight: "12.5..18"
  }), {
    validatedObject: {
      arrivalDate: {
        from: "2026-04-01",
        to: "2026-04-30"
      },
      status: ["active", "archived"],
      supplierContactId: ["7", "4"],
      weight: {
        min: 12.5,
        max: 18
      }
    },
    errors: {}
  });
});

test("createCrudListFilters discard validator returns canonical partial values directly", () => {
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
  const transportSchema = validator.schema.toJsonSchema({
    mode: validator.mode
  });

  assert.equal(transportSchema.type, "object");
  assert.equal(transportSchema.properties.arrivalDate.minLength, 0);
  assert.equal(transportSchema.properties.status.anyOf[0].minLength, 0);
  assert.equal(transportSchema.properties.supplierContactId.anyOf[0].anyOf[0].minLength, 0);
  assert.deepEqual(validator.schema.patch({
    arrivalDate: "bad-date..2026-04-30",
    status: ["active", "unexpected"],
    supplierContactId: ["7", "bad"],
    weight: "bad..18"
  }), {
    validatedObject: {
      arrivalDate: {
        to: "2026-04-30"
      },
      status: ["active"],
      supplierContactId: ["7"],
      weight: {
        max: 18
      }
    },
    errors: {}
  });
  assert.deepEqual(runtime.normalize({
    arrivalDate: "bad-date..2026-04-30",
    status: ["active", "unexpected"],
    supplierContactId: ["7", "bad"],
    weight: "bad..18"
  }), {
    arrivalDate: {
      to: "2026-04-30"
    },
    status: ["active"],
    supplierContactId: ["7"],
    weight: {
      max: 18
    }
  });
});

test("createCrudListFilters treats exact range filter values as exact bounds", () => {
  const runtime = createCrudListFilters({
    arrivalDate: {
      type: "dateRange",
      label: "Arrival Date"
    },
    weight: {
      type: "numberRange",
      label: "Weight"
    }
  });

  assert.deepEqual(runtime.normalize({
    arrivalDate: "2026-04-18",
    weight: 12.5
  }), {
    arrivalDate: {
      from: "2026-04-18",
      to: "2026-04-18"
    },
    weight: {
      min: 12.5,
      max: 12.5
    }
  });
});

test("createCrudListFilters exposes no default query validator alias", () => {
  const runtime = createCrudListFilters({
    arrivalDate: {
      type: "dateRange",
      label: "Arrival Date"
    }
  });

  assert.equal(Object.hasOwn(runtime, "query"), false);
  assert.equal(runtime.query, undefined);
});
