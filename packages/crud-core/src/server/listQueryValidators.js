import { createSchema } from "json-rest-schema";
import {
  cursorPaginationQueryValidator
} from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudParentFilterKeys as resolveSharedCrudParentFilterKeys } from "@jskit-ai/resource-crud-core/shared/crudLookup";
import { resolveJsonApiFieldsetContract } from "./jsonApiResourceContract.js";

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
      required: false,
      messages: {
        default: "include expects a comma-separated string such as \"pet,service\"."
      }
    }
  }),
  mode: "patch"
});

function createJsonApiFieldsetValueDefinition({ allowedFields = [] } = {}) {
  const normalizedAllowedFields = [...new Set(
    (Array.isArray(allowedFields) ? allowedFields : [])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];

  return Object.freeze({
    type: "array",
    required: false,
    items: {
      type: "string",
      minLength: 1,
      ...(normalizedAllowedFields.length > 0
        ? { enum: Object.freeze(normalizedAllowedFields) }
        : {})
    }
  });
}

const jsonApiFieldsetValueDefinition = createJsonApiFieldsetValueDefinition();

const jsonApiFieldsetsQueryValidator = Object.freeze({
  schema: createSchema({
    fields: {
      type: "object",
      required: false,
      messages: {
        default: "fields expects an object such as {\"bookings\":[\"petId\"],\"pets\":[\"name\"]}."
      },
      values: jsonApiFieldsetValueDefinition
    }
  }),
  mode: "patch"
});

function createJsonApiFieldsetsQueryValidator({ resource = {} } = {}) {
  const contract = resolveJsonApiFieldsetContract(resource);
  if (!contract.primaryType || contract.resourceTypes.length < 1) {
    return jsonApiFieldsetsQueryValidator;
  }

  const firstRelationship = contract.relationshipEntries[0] || null;
  const example = firstRelationship
    ? `{"${contract.primaryType}":["${firstRelationship.attributeKey}"],` +
      `"${firstRelationship.relationshipType}":["${firstRelationship.labelKey || "id"}"]}`
    : `{"${contract.primaryType}":["id"]}`;
  const allowedTypes = contract.resourceTypes.map((entry) => `"${entry}"`).join(", ");
  const aliasGuidance = contract.aliasMappings
    .map((entry) => `use "${entry.resourceType}" instead of "${entry.alias}"`)
    .join("; ");
  const additionalPropertiesMessage =
    `fields keys must be JSON:API resource types. Allowed keys: ${allowedTypes}.` +
    (aliasGuidance ? ` Relationship aliases are invalid keys; ${aliasGuidance}.` : "");
  const fieldsetSchema = createSchema(
    Object.fromEntries(
      contract.resourceTypes.map((resourceType) => [
        resourceType,
        createJsonApiFieldsetValueDefinition({
          allowedFields: resourceType === contract.primaryType ? contract.primaryFields : []
        })
      ])
    )
  );

  return Object.freeze({
    schema: createSchema({
      fields: {
        type: "object",
        required: false,
        schema: fieldsetSchema,
        messages: {
          default: `fields expects an object keyed by JSON:API resource type, such as ${example}.`,
          additionalProperties: additionalPropertiesMessage
        }
      }
    }),
    mode: "patch"
  });
}

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
  includeQueryValidator = lookupIncludeQueryValidator,
  fieldsetsQueryValidator = jsonApiFieldsetsQueryValidator
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
    fieldsetsQueryValidator
  ];
}

function createStandardCrudViewQueryValidators({
  includeQueryValidator = lookupIncludeQueryValidator,
  fieldsetsQueryValidator = jsonApiFieldsetsQueryValidator
} = {}) {
  return [
    includeQueryValidator,
    fieldsetsQueryValidator
  ];
}

export {
  createCrudCursorPaginationQueryValidator,
  createJsonApiFieldsetsQueryValidator,
  listSearchQueryValidator,
  lookupIncludeQueryValidator,
  jsonApiFieldsetsQueryValidator,
  resolveCrudParentFilterKeys,
  createCrudParentFilterQueryValidator,
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
};
