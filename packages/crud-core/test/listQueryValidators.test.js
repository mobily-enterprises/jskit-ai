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
  lookupIncludeQueryValidator,
  createCrudCursorPaginationQueryValidator,
  createJsonApiFieldsetsQueryValidator,
  createCrudParentFilterQueryValidator,
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators,
  resolveCrudParentFilterKeys
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

test("resolveCrudParentFilterKeys returns lookup keys that exist in create schema", () => {
  const resource = createCrudResource({
    viewFields: {
      contactId: {
        type: "integer",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      },
      vetId: {
        type: "integer",
        relation: {
          kind: "lookup",
          apiPath: "/vets",
          valueKey: "id"
        }
      },
      ignoredLookup: {
        type: "integer",
        relation: {
          kind: "lookup",
          apiPath: "/ignored",
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
      },
      name: { type: "string" },
      vetId: {
        type: "integer",
        relation: {
          kind: "lookup",
          apiPath: "/vets",
          valueKey: "id"
        }
      }
    }
  });

  assert.deepEqual(resolveCrudParentFilterKeys(resource), ["contactId", "vetId"]);
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
    defaultSort: ["-createdAt"],
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
    ["archived", "currentness", "cursor", "fields", "include", "limit", "q"]
  );

  const viewQueryValidator = composeSchemaDefinition(
    ...createStandardCrudViewQueryValidators()
  );
  assert.deepEqual(
    Object.keys(viewQueryValidator.schema.getFieldDefinitions()).sort(),
    ["fields", "include"]
  );
});
