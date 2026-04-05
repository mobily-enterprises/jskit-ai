import { Type } from "typebox";
import {
  normalizeObjectInput,
  positiveIntegerValidator,
  cursorPaginationQueryValidator
} from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudLookupFieldKeys } from "@jskit-ai/kernel/shared/support/crudLookup";

const listSearchQueryValidator = Object.freeze({
  schema: Type.Object(
    {
      q: Type.Optional(Type.String({ minLength: 0 }))
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    if (!Object.hasOwn(source, "q")) {
      return {};
    }

    return {
      q: normalizeText(source.q)
    };
  }
});

const lookupIncludeQueryValidator = Object.freeze({
  schema: Type.Object(
    {
      include: Type.Optional(Type.String({ minLength: 0 }))
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    if (!Object.hasOwn(source, "include")) {
      return {};
    }

    return {
      include: normalizeText(source.include)
    };
  }
});

function resolveCrudListUsesOrderedCursor(list = {}) {
  const orderBy = Array.isArray(list?.orderBy) ? list.orderBy : [];
  for (const entry of orderBy) {
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
    schema: Type.Object(
      {
        cursor: Type.Optional(
          Type.Union([
            positiveIntegerValidator.schema,
            Type.String({ minLength: 1 })
          ])
        ),
        limit: Type.Optional(positiveIntegerValidator.schema)
      },
      { additionalProperties: false }
    ),
    normalize(payload = {}) {
      const source = normalizeObjectInput(payload);
      const normalized = {};

      if (Object.hasOwn(source, "cursor")) {
        normalized.cursor = normalizeText(source.cursor);
      }

      if (Object.hasOwn(source, "limit")) {
        normalized.limit = positiveIntegerValidator.normalize(source.limit);
      }

      return normalized;
    }
  });
}

function resolveCrudParentFilterKeys(resource = {}) {
  const createSchemaProperties = resource?.operations?.create?.bodyValidator?.schema?.properties;
  const allowedKeys = createSchemaProperties && typeof createSchemaProperties === "object" && !Array.isArray(createSchemaProperties)
    ? Object.keys(createSchemaProperties)
    : [];
  return resolveCrudLookupFieldKeys(resource, {
    allowKeys: allowedKeys
  });
}

function createCrudParentFilterQueryValidator(resource = {}) {
  const keys = resolveCrudParentFilterKeys(resource);
  const schemaProperties = {};
  for (const key of keys) {
    schemaProperties[key] = Type.Optional(Type.String({ minLength: 1 }));
  }

  return Object.freeze({
    schema: Type.Object(schemaProperties, { additionalProperties: false }),
    normalize(payload = {}) {
      const source = normalizeObjectInput(payload);
      const normalized = {};
      for (const key of keys) {
        if (!Object.hasOwn(source, key)) {
          continue;
        }

        const value = normalizeText(source[key]);
        if (value) {
          normalized[key] = value;
        }
      }

      return normalized;
    }
  });
}

export {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator,
  lookupIncludeQueryValidator,
  resolveCrudParentFilterKeys,
  createCrudParentFilterQueryValidator
};
