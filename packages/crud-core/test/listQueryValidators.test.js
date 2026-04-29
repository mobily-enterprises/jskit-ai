import test from "node:test";
import assert from "node:assert/strict";
import {
  cursorPaginationQueryValidator,
  validateSchemaPayload
} from "@jskit-ai/kernel/shared/validators";
import { compileRouteValidator } from "@jskit-ai/kernel/_testable";
import {
  listSearchQueryValidator,
  lookupIncludeQueryValidator,
  createCrudCursorPaginationQueryValidator,
  createCrudParentFilterQueryValidator,
  resolveCrudParentFilterKeys
} from "../src/server/listQueryValidators.js";

function createCrudResource({
  viewFields = {},
  createFields = {},
  patchFields = {}
} = {}) {
  return {
    operations: {
      view: {
        output: {
          schema: {
            type: "object",
            properties: viewFields
          }
        }
      },
      create: {
        body: {
          schema: {
            type: "object",
            properties: createFields
          }
        }
      },
      patch: {
        body: {
          schema: {
            type: "object",
            properties: patchFields
          }
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
    query: [cursorPaginationQueryValidator, listSearchQueryValidator]
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
    query: [cursorPaginationQueryValidator, listSearchQueryValidator, lookupIncludeQueryValidator]
  });

  assert.deepEqual(compiled.schema.querystring.required || [], []);
});

test("createCrudCursorPaginationQueryValidator keeps numeric cursor validation for unordered lists", () => {
  const validator = createCrudCursorPaginationQueryValidator({});

  assert.equal(validator, cursorPaginationQueryValidator);
});

test("createCrudCursorPaginationQueryValidator allows opaque cursor strings for ordered lists", () => {
  const validator = createCrudCursorPaginationQueryValidator({
    orderBy: [
      {
        column: "created_at",
        direction: "desc"
      }
    ]
  });

  assert.notEqual(validator, cursorPaginationQueryValidator);
  return validateSchemaPayload(validator, { cursor: "  offset:3  ", limit: "25" }, { phase: "input" })
    .then((normalized) => {
      assert.deepEqual(normalized, {
        cursor: "offset:3",
        limit: 25
      });
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

  assert.deepEqual(Object.keys(validator.schema.structure), ["staffContactId"]);
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
    query: [cursorPaginationQueryValidator, listSearchQueryValidator, parentValidator]
  });
  assert.deepEqual(compiled.schema.querystring.required || [], []);
});
