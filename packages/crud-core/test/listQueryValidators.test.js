import test from "node:test";
import assert from "node:assert/strict";
import {
  cursorPaginationQueryValidator
} from "@jskit-ai/kernel/shared/validators";
import { compileRouteValidator } from "@jskit-ai/kernel/_testable";
import {
  listSearchQueryValidator,
  lookupIncludeQueryValidator,
  createCrudCursorPaginationQueryValidator,
  createCrudParentFilterQueryValidator,
  resolveCrudParentFilterKeys
} from "../src/server/listQueryValidators.js";

test("listSearchQueryValidator normalizes q", () => {
  const normalized = listSearchQueryValidator.normalize({
    q: "  ani  "
  });

  assert.deepEqual(normalized, {
    q: "ani"
  });
});

test("listSearchQueryValidator keeps q optional when merged with pagination query validator", () => {
  const compiled = compileRouteValidator({
    queryValidator: [cursorPaginationQueryValidator, listSearchQueryValidator]
  });

  assert.deepEqual(compiled.schema.querystring.required || [], []);
});

test("lookupIncludeQueryValidator normalizes include", () => {
  const normalized = lookupIncludeQueryValidator.normalize({
    include: "  vetId,ownerId  "
  });

  assert.deepEqual(normalized, {
    include: "vetId,ownerId"
  });
});

test("lookupIncludeQueryValidator keeps include optional when merged with pagination and search", () => {
  const compiled = compileRouteValidator({
    queryValidator: [cursorPaginationQueryValidator, listSearchQueryValidator, lookupIncludeQueryValidator]
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
  assert.deepEqual(validator.normalize({ cursor: "  offset:3  ", limit: "25" }), {
    cursor: "offset:3",
    limit: 25
  });
});

test("resolveCrudParentFilterKeys returns lookup keys that exist in create schema", () => {
  const resource = {
    operations: {
      create: {
        bodyValidator: {
          schema: {
            type: "object",
            properties: {
              contactId: { type: "integer" },
              name: { type: "string" },
              vetId: { type: "integer" }
            }
          }
        }
      }
    },
    fieldMeta: [
      {
        key: "contactId",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      },
      {
        key: "vetId",
        relation: {
          kind: "lookup",
          apiPath: "/vets",
          valueKey: "id"
        }
      },
      {
        key: "ignoredLookup",
        relation: {
          kind: "lookup",
          apiPath: "/ignored",
          valueKey: "id"
        }
      }
    ]
  };

  assert.deepEqual(resolveCrudParentFilterKeys(resource), ["contactId", "vetId"]);
});

test("createCrudParentFilterQueryValidator normalizes configured parent filters", () => {
  const validator = createCrudParentFilterQueryValidator({
    operations: {
      create: {
        bodyValidator: {
          schema: {
            type: "object",
            properties: {
              contactId: { type: "integer" }
            }
          }
        }
      }
    },
    fieldMeta: [
      {
        key: "contactId",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      }
    ]
  });

  const normalized = validator.normalize({
    contactId: "  42  ",
    unknown: "x"
  });
  assert.deepEqual(normalized, {
    contactId: "42"
  });
});

test("createCrudParentFilterQueryValidator keeps parent filters optional when merged", () => {
  const parentValidator = createCrudParentFilterQueryValidator({
    operations: {
      create: {
        bodyValidator: {
          schema: {
            type: "object",
            properties: {
              contactId: { type: "integer" }
            }
          }
        }
      }
    },
    fieldMeta: [
      {
        key: "contactId",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      }
    ]
  });

  const compiled = compileRouteValidator({
    queryValidator: [cursorPaginationQueryValidator, listSearchQueryValidator, parentValidator]
  });
  assert.deepEqual(compiled.schema.querystring.required || [], []);
});
