import test from "node:test";
import assert from "node:assert/strict";
import {
  cursorPaginationQueryValidator
} from "@jskit-ai/kernel/shared/validators";
import { compileRouteValidator } from "@jskit-ai/kernel/_testable";
import {
  listSearchQueryValidator,
  lookupIncludeQueryValidator,
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

test("createCrudParentFilterQueryValidator keeps canonical field keys when fieldMeta declares parent route aliases", () => {
  const validator = createCrudParentFilterQueryValidator({
    operations: {
      create: {
        bodyValidator: {
          schema: {
            type: "object",
            properties: {
              staffContactId: { type: "integer" }
            }
          }
        }
      }
    },
    fieldMeta: [
      {
        key: "staffContactId",
        parentRouteParamKey: "contactId",
        relation: {
          kind: "lookup",
          apiPath: "/contacts",
          valueKey: "id"
        }
      }
    ]
  });

  assert.deepEqual(Object.keys(validator.schema.properties), ["staffContactId"]);
  assert.deepEqual(validator.normalize({
    staffContactId: " 42 ",
    contactId: " 99 "
  }), {
    staffContactId: "42"
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
