import { createSchema } from "json-rest-schema";
import {
  cursorPaginationQueryValidator
} from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudParentFilterKeys as resolveSharedCrudParentFilterKeys } from "@jskit-ai/resource-crud-core/shared/crudLookup";

const listSearchQueryValidator = Object.freeze({
  schema: createSchema({
    q: {
      type: "string",
      required: false
    }
  }),
  mode: "patch"
});

const lookupIncludeQueryValidator = Object.freeze({
  schema: createSchema({
    include: {
      type: "string",
      required: false
    }
  }),
  mode: "patch"
});

const jsonApiFieldsetsQueryValidator = Object.freeze({
  schema: createSchema({
    fields: {
      type: "object",
      required: false,
      values: {
        type: "array",
        items: {
          type: "string",
          minLength: 1
        }
      }
    }
  }),
  mode: "patch"
});

function resolveCrudListUsesOrderedCursor(list = {}) {
  const entries = Array.isArray(list?.orderBy)
    ? list.orderBy
    : list?.orderBy == null
      ? []
      : [list.orderBy];

  for (const entry of entries) {
    if (typeof entry === "string" && normalizeText(entry)) {
      return true;
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry) && normalizeText(entry.column)) {
      return true;
    }
  }

  return false;
}

function createCrudCursorPaginationQueryValidator(list = {}) {
  if (resolveCrudListUsesOrderedCursor(list) !== true) {
    return cursorPaginationQueryValidator;
  }

  return Object.freeze({
    schema: createSchema({
      cursor: {
        type: "string",
        required: false,
        minLength: 1
      },
      limit: {
        type: "number",
        required: false,
        min: 1,
        unsigned: true
      }
    }),
    mode: "patch"
  });
}

function resolveCrudParentFilterKeys(resource = {}) {
  return resolveSharedCrudParentFilterKeys(resource);
}

function createCrudParentFilterQueryValidator(resource = {}) {
  const keys = resolveCrudParentFilterKeys(resource);
  const schemaProperties = {};
  for (const key of keys) {
    schemaProperties[key] = {
      type: "string",
      required: false,
      minLength: 1
    };
  }

  return Object.freeze({
    schema: createSchema(schemaProperties),
    mode: "patch"
  });
}

function createStandardCrudListQueryValidators({
  resource = {},
  listFilterQueryValidator = null,
  searchQueryValidator = listSearchQueryValidator,
  includeQueryValidator = lookupIncludeQueryValidator
} = {}) {
  const resolvedListFilterQueryValidator =
    listFilterQueryValidator
    ?? resource?.contract?.listFilters?.queryValidator
    ?? null;

  return [
    createCrudCursorPaginationQueryValidator({
      orderBy: resource?.defaultSort
    }),
    searchQueryValidator,
    createCrudParentFilterQueryValidator(resource),
    ...(resolvedListFilterQueryValidator
      ? [resolvedListFilterQueryValidator]
      : []),
    includeQueryValidator,
    jsonApiFieldsetsQueryValidator
  ];
}

function createStandardCrudViewQueryValidators({
  includeQueryValidator = lookupIncludeQueryValidator
} = {}) {
  return [
    includeQueryValidator,
    jsonApiFieldsetsQueryValidator
  ];
}

export {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator,
  lookupIncludeQueryValidator,
  jsonApiFieldsetsQueryValidator,
  resolveCrudParentFilterKeys,
  createCrudParentFilterQueryValidator,
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
};
