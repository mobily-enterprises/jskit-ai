import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import {
  cursorPaginationQueryValidator,
  validateSchemaPayload
} from "@jskit-ai/kernel/shared/validators";
import { compileRouteValidator } from "@jskit-ai/kernel/_testable";
import {
  listSearchQueryValidator,
  listRecordIdsQueryValidator,
  lookupIncludeQueryValidator,
  createCrudCursorPaginationQueryValidator,
  createJsonApiFieldsetsQueryValidator,
  createIncludedFieldsetsCheck,
  createCrudParentFilterQueryValidator,
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
} from "../src/server/listQueryValidators.js";

function composeSchemaDefinition(...definitions) {
  return Object.freeze({
    schema: createSchema(
      Object.assign({}, ...definitions.map((definition) => definition.schema.getFieldDefinitions()))
    ),
    mode: "patch"
  });
}

function createCrudResource({
  namespace = "",
  viewFields = {},
  createFields = {},
  patchFields = {}
} = {}) {
  return {
    ...(namespace ? { namespace } : {}),
    operations: {
      view: {
        output: {
          schema: createSchema(viewFields),
          mode: "replace"
        }
      },
      create: {
        body: {
          schema: createSchema(createFields),
          mode: "create"
        }
      },
      patch: {
        body: {
          schema: createSchema(patchFields),
          mode: "patch"
        }
      }
    }
  };
}

test("listSearchQueryValidator normalizes q", async () => {
  const normalized = await validateSchemaPayload(listSearchQueryValidator, {
    q: "  ani  "
  }, { phase: "input" });

  assert.deepEqual(normalized, {
    q: "ani"
  });
});

test("listRecordIdsQueryValidator takes one record id or a list of them as a list", () => {
  assert.deepEqual(validateSchemaPayload(listRecordIdsQueryValidator, { id: "7" }, { phase: "input" }), { id: ["7"] });
  assert.deepEqual(
    validateSchemaPayload(listRecordIdsQueryValidator, { id: ["7", "12"] }, { phase: "input" }),
    { id: ["7", "12"] }
  );
  assert.throws(() => validateSchemaPayload(listRecordIdsQueryValidator, { id: "seven" }, { phase: "input" }));
  const compiled = compileRouteValidator({ query: listRecordIdsQueryValidator });
  assert.deepEqual(compiled.schema.querystring.required || [], []);
});

test("listSearchQueryValidator keeps q optional when merged with pagination query validator", () => {
  const compiled = compileRouteValidator({
    query: composeSchemaDefinition(cursorPaginationQueryValidator, listSearchQueryValidator)
  });

  assert.deepEqual(compiled.schema.querystring.required || [], []);
});

test("lookupIncludeQueryValidator normalizes include", async () => {
  const normalized = await validateSchemaPayload(lookupIncludeQueryValidator, {
    include: "  vetId,ownerId  "
  }, { phase: "input" });

  assert.deepEqual(normalized, {
    include: "vetId,ownerId"
  });
});

test("lookupIncludeQueryValidator keeps include optional when merged with pagination and search", () => {
  const compiled = compileRouteValidator({
    query: composeSchemaDefinition(cursorPaginationQueryValidator, listSearchQueryValidator, lookupIncludeQueryValidator)
  });

  assert.deepEqual(compiled.schema.querystring.required || [], []);
});

test("resource-aware sparse fieldsets enumerate JSON:API types and reject relationship aliases", () => {
  const resource = createCrudResource({
    namespace: "bookings",
    viewFields: {
      petId: {
        type: "integer",
        belongsTo: "pets",
        as: "pet",
        relation: {
          labelKey: "name"
        }
      },
      serviceId: {
        type: "integer",
        belongsTo: "services",
        as: "service",
        relation: {
          labelKey: "name"
        }
      }
    }
  });
  const validator = createJsonApiFieldsetsQueryValidator({ resource });
  const transportSchema = validator.schema.toJsonSchema({ mode: "patch" });
  const fieldsetReference = transportSchema.properties.fields.allOf[0].$ref;
  const fieldsetSchema = transportSchema.definitions[fieldsetReference.slice("#/definitions/".length)];

  assert.deepEqual(Object.keys(fieldsetSchema.properties), ["bookings", "pets", "services"]);
  assert.equal(fieldsetSchema.additionalProperties, false);
  assert.deepEqual(fieldsetSchema.properties.bookings.items.enum, ["petId", "serviceId"]);
  assert.equal(Object.hasOwn(fieldsetSchema.properties.pets.items, "enum"), false);
  assert.deepEqual(validateSchemaPayload(validator, {
    fields: {
      bookings: ["petId"],
      pets: ["name"]
    }
  }, { phase: "input" }), {
    fields: {
      bookings: ["petId"],
      pets: ["name"]
    }
  });
  assert.throws(
    () => validateSchemaPayload(validator, {
      fields: {
        pet: ["name"]
      }
    }, { phase: "input" }),
    (error) => {
      assert.match(error.fieldErrors?.["fields.pet"] || "", /Allowed keys: "bookings", "pets", "services"/u);
      assert.match(error.fieldErrors?.["fields.pet"] || "", /use "pets" instead of "pet"/u);
      return true;
    }
  );
});

test("a fieldset for a type the includes reach below their first level waits for the types boot resolves, then names only fields shown there", () => {
  // orders -> customer (customers) -> region (regions): only the customers table names the region's type.
  const resource = createCrudResource({
    namespace: "orders",
    viewFields: {
      reference: { type: "string" },
      customerId: { type: "integer", belongsTo: "customers", as: "customer", includeFields: ["name", { region: ["name", "code"] }] }
    }
  });
  const refusal = (run) => {
    try {
      run();
    } catch (error) {
      return error;
    }
    return assert.fail("expected a refusal");
  };

  // Without deferIncludedTypes the schema refuses the key, as it refuses any type it does not name.
  const strict = refusal(() => validateSchemaPayload(createJsonApiFieldsetsQueryValidator({ resource }), {
    fields: { regions: ["name"] }
  }, { phase: "input" }));
  assert.equal(strict.fieldErrorCodes?.["fields.regions"]?.code, "crud.query.fieldsKeysInvalidWithAliases");

  // Deferred, the schema lets the keys it cannot name through, and still checks those it names.
  const deferred = createJsonApiFieldsetsQueryValidator({ resource, deferIncludedTypes: true });
  assert.deepEqual(validateSchemaPayload(deferred, {
    fields: { orders: ["reference"], regions: ["name"], tags: ["label"] }
  }, { phase: "input" }), { fields: { orders: ["reference"], regions: ["name"], tags: ["label"] } });
  assert.ok(refusal(() => validateSchemaPayload(deferred, { fields: { orders: ["secret"] } }, { phase: "input" })).fieldErrors);
  // A contract whose includes stop at their first level has nothing to defer.
  const flat = createCrudResource({ namespace: "orders", viewFields: { customerId: { type: "integer", belongsTo: "customers", as: "customer" } } });
  assert.equal(
    refusal(() => validateSchemaPayload(createJsonApiFieldsetsQueryValidator({ resource: flat, deferIncludedTypes: true }), {
      fields: { regions: ["name"] }
    }, { phase: "input" })).fieldErrorCodes?.["fields.regions"]?.code,
    "crud.query.fieldsKeysInvalidWithAliases"
  );

  // The check takes the region's fields the include shows, and refuses any other field and any type it does not reach.
  const check = createIncludedFieldsetsCheck(resource);
  const includedTypes = new Map([["regions", new Set(["name", "code"])]]);
  check({ orders: ["reference"], customers: ["name"], regions: ["name", "code"] }, includedTypes);
  check(undefined, includedTypes);
  const hidden = refusal(() => check({ regions: ["name", "secret"] }, includedTypes));
  assert.equal(hidden.status, 400);
  assert.deepEqual(hidden.details.fieldErrorCodes["fields.regions"], {
    code: "crud.query.fieldsNotShown",
    params: { type: "regions", shown: "name, code", fields: "secret" }
  });
  assert.equal(
    hidden.details.fieldErrors["fields.regions"],
    "fields[regions] may name only what this read's includes show of regions: name, code. It names secret."
  );
  const unrelated = refusal(() => check({ tags: ["label"] }, includedTypes));
  assert.equal(unrelated.details.fieldErrorCodes["fields.tags"].code, "crud.query.fieldsKeysInvalidWithAliases");
  assert.match(unrelated.details.fieldErrors["fields.tags"], /Allowed keys: "orders", "customers", "regions"\./u);
  // Before boot resolves the types (or with no table resources), no such type is reached.
  assert.equal(refusal(() => check({ regions: ["name"] }, new Map())).details.fieldErrorCodes["fields.regions"].code,
    "crud.query.fieldsKeysInvalidWithAliases");
});

test("createCrudCursorPaginationQueryValidator keeps numeric cursor validation for unordered lists", () => {
  const validator = createCrudCursorPaginationQueryValidator({});

  assert.equal(validator, cursorPaginationQueryValidator);
});

test("createCrudCursorPaginationQueryValidator allows opaque cursor strings for ordered lists", () => {
  const validator = createCrudCursorPaginationQueryValidator({
    orderBy: ["-createdAt"]
  });

  assert.notEqual(validator, cursorPaginationQueryValidator);
  const normalized = validateSchemaPayload(validator, { cursor: "  offset:3  ", limit: "25" }, { phase: "input" });
  assert.deepEqual(normalized, {
    cursor: "offset:3",
    limit: 25
  });
});

test("createCrudParentFilterQueryValidator normalizes configured parent filters", async () => {
  const validator = createCrudParentFilterQueryValidator(createCrudResource({
    viewFields: {
      contactId: {
        type: "integer",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      }
    },
    createFields: {
      contactId: {
        type: "integer",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      }
    }
  }));

  const normalized = await validateSchemaPayload(validator, {
    contactId: "  42  "
  }, { phase: "input" });
  assert.deepEqual(normalized, {
    contactId: "42"
  });
});

test("createCrudParentFilterQueryValidator keeps canonical field keys when schema declares parent route aliases", async () => {
  const validator = createCrudParentFilterQueryValidator(createCrudResource({
    viewFields: {
      staffContactId: {
        type: "integer",
        parentRouteParamKey: "contactId",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      }
    },
    createFields: {
      staffContactId: {
        type: "integer",
        parentRouteParamKey: "contactId",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      }
    }
  }));

  assert.deepEqual(Object.keys(validator.schema.getFieldDefinitions()), ["staffContactId"]);
  assert.deepEqual(await validateSchemaPayload(validator, {
    staffContactId: " 42 "
  }, { phase: "input" }), {
    staffContactId: "42"
  });
});

test("createCrudParentFilterQueryValidator keeps parent filters optional when merged", () => {
  const parentValidator = createCrudParentFilterQueryValidator(createCrudResource({
    viewFields: {
      contactId: {
        type: "integer",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      }
    },
    createFields: {
      contactId: {
        type: "integer",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      }
    }
  }));

  const compiled = compileRouteValidator({
    query: composeSchemaDefinition(cursorPaginationQueryValidator, listSearchQueryValidator, parentValidator)
  });
  assert.deepEqual(compiled.schema.querystring.required || [], []);
});

test("standard CRUD query validator groups remain plain and extensible", () => {
  const listFilterQueryValidator = {
    schema: createSchema({
      currentness: {
        type: "string",
        required: false
      }
    }),
    mode: "patch"
  };
  const resource = {
    ...createCrudResource(),
    resource: { defaultSort: ["-createdAt"] },
    contract: {
      listFilters: {
        queryValidator: listFilterQueryValidator
      }
    }
  };

  const listQueryValidator = composeSchemaDefinition(
    ...createStandardCrudListQueryValidators({ resource }),
    {
      schema: createSchema({
        archived: {
          type: "boolean",
          required: false
        }
      }),
      mode: "patch"
    }
  );
  assert.deepEqual(
    Object.keys(listQueryValidator.schema.getFieldDefinitions()).sort(),
    ["archived", "currentness", "cursor", "fields", "id", "include", "limit", "q"]
  );

  const viewQueryValidator = composeSchemaDefinition(
    ...createStandardCrudViewQueryValidators()
  );
  assert.deepEqual(
    Object.keys(viewQueryValidator.schema.getFieldDefinitions()).sort(),
    ["fields", "include"]
  );
});
