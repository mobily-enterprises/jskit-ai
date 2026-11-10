import { createSchema } from "json-rest-schema";
import {
  cursorPaginationQueryValidator
} from "@jskit-ai/kernel/shared/validators";
import { createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeJsonApiFieldList } from "@jskit-ai/kernel/shared/support/jsonApiFieldsets";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudParentFilterKeys } from "@jskit-ai/resource-crud-core/shared/crudLookup";
import {
  CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY,
  defineCrudListFilters
} from "@jskit-ai/resource-crud-core/shared/crudListFilters";
import { resolveJsonApiFieldsetContract } from "./jsonApiResourceContract.js";
import { buildFilterQuerySchemaDefinition } from "./listFilterTypes.js";

const listSearchQueryValidator = Object.freeze({
  schema: createSchema({
    q: {
      type: "string",
      required: false
    }
  }),
  mode: "patch"
});

// `id`, one record id or a list of them, narrows a list to those rows (the handle's own id filter), so a picker
// reads the selected values its loaded page lacks in one request instead of showing their raw ids.
const listRecordIdsQueryValidator = buildFilterQuerySchemaDefinition(Object.values(defineCrudListFilters({
  id: { type: CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY, label: "Id" }
})));

const lookupIncludeQueryValidator = Object.freeze({
  schema: createSchema({
    include: {
      type: "string",
      required: false,
      messages: {
        default: {
          code: "crud.query.includeInvalid",
          message: "include expects a comma-separated string such as \"author,publisher\".",
          params: { example: "author,publisher" }
        }
      }
    }
  }),
  mode: "patch"
});

function buildJsonApiFieldsetValueDefinition({ allowedFields = [] } = {}) {
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

const jsonApiFieldsetValueDefinition = buildJsonApiFieldsetValueDefinition();

const jsonApiFieldsetsQueryValidator = Object.freeze({
  schema: createSchema({
    fields: {
      type: "object",
      required: false,
      messages: {
        default: {
          code: "crud.query.fieldsInvalid",
          message: "fields expects an object such as {\"books\":[\"authorId\"],\"authors\":[\"name\"]}.",
          params: { example: "{\"books\":[\"authorId\"],\"authors\":[\"name\"]}" }
        }
      },
      values: jsonApiFieldsetValueDefinition
    }
  }),
  mode: "patch"
});

/**
 * The coded refusal of a fieldset key that is none of the resource types a read takes, naming the resource type to
 * use for each of the contract's relationship aliases.
 * @param {ReturnType<typeof resolveJsonApiFieldsetContract>} contract
 * @param {readonly string[]} resourceTypes
 */
function fieldsetKeysRefusal(contract, resourceTypes) {
  const allowedTypes = resourceTypes.map((entry) => `"${entry}"`).join(", ");
  const aliasGuidance = contract.aliasMappings
    .map((entry) => `use "${entry.resourceType}" instead of "${entry.alias}"`)
    .join("; ");
  return aliasGuidance
    ? {
        code: "crud.query.fieldsKeysInvalidWithAliases",
        message: `fields keys must be JSON:API resource types. Allowed keys: ${allowedTypes}.` +
          ` Relationship aliases are invalid keys; ${aliasGuidance}.`,
        params: { allowedTypes, aliasGuidance }
      }
    : {
        code: "crud.query.fieldsKeysInvalid",
        message: `fields keys must be JSON:API resource types. Allowed keys: ${allowedTypes}.`,
        params: { allowedTypes }
      };
}

/**
 * The sparse fieldsets a CRUD contract's reads take, keyed by JSON:API resource type: its own type, with the fields
 * its view output names, and each type it links to. A type its includes reach below their first level
 * (`includeFields: ["name", { breed: ["name"] }]` reaches the breed's type) is named only by the tables an include
 * crosses, so this schema cannot name it. Such a key is refused, like any other unknown key, unless
 * `deferIncludedTypes` lets it through to createIncludedFieldsetsCheck, which the CRUD actions run once boot has
 * resolved those types.
 * @param {object} [options]
 * @param {object} [options.resource] The CRUD contract.
 * @param {boolean} [options.deferIncludedTypes]
 */
function createJsonApiFieldsetsQueryValidator({ resource = {}, deferIncludedTypes = false } = {}) {
  const contract = resolveJsonApiFieldsetContract(resource);
  if (!contract.primaryType || contract.resourceTypes.length < 1) {
    return jsonApiFieldsetsQueryValidator;
  }

  const firstRelationship = contract.relationshipEntries[0] || null;
  const example = firstRelationship
    ? `{"${contract.primaryType}":["${firstRelationship.attributeKey}"],` +
      `"${firstRelationship.relationshipType}":["${firstRelationship.labelKey || "id"}"]}`
    : `{"${contract.primaryType}":["id"]}`;
  const fieldsetSchema = createSchema(
    Object.fromEntries(
      contract.resourceTypes.map((resourceType) => [
        resourceType,
        buildJsonApiFieldsetValueDefinition({
          allowedFields: resourceType === contract.primaryType ? contract.primaryFields : []
        })
      ])
    )
  );
  const reachesNestedTypes = contract.relationshipEntries.some(({ include }) => Object.keys(include.relationships).length > 0);

  return Object.freeze({
    schema: createSchema({
      fields: {
        type: "object",
        required: false,
        schema: fieldsetSchema,
        ...(deferIncludedTypes && reachesNestedTypes ? { additionalProperties: true } : {}),
        messages: {
          default: {
            code: "crud.query.fieldsByTypeInvalid",
            message: `fields expects an object keyed by JSON:API resource type, such as ${example}.`,
            params: { example }
          },
          additionalProperties: fieldsetKeysRefusal(contract, contract.resourceTypes)
        }
      }
    }),
    mode: "patch"
  });
}

/**
 * The check of the sparse fieldsets createJsonApiFieldsetsQueryValidator deferred: keys for none of the resource types
 * its schema names. A type the resource's includes reach below their first level takes only the fields they show of
 * it there; any other key is refused as the validator refuses one. So
 * `include=customer,customer.region&fields[regions]=name` narrows the included regions when the include lists
 * `{ region: ["name", ...] }`, and the includes still decide what an included record can show. The check throws a
 * validation error naming each refused fieldset.
 * @param {object} resource The CRUD contract.
 * @returns {(fields: unknown, includedTypes: ReadonlyMap<string, ReadonlySet<string>>) => void} Takes the validated
 *   input's `fields` and the types the includes reach below their first level, each with the fields it shows there,
 *   as the CRUD contracts resolved them at boot (`includedTypes`).
 */
function createIncludedFieldsetsCheck(resource) {
  // Worked out at the first read that names fieldsets, so composing a feature costs nothing more.
  let contract = null;
  let namedTypes = null;

  return function checkIncludedFieldsets(fields, includedTypes) {
    if (!isRecord(fields)) {
      return;
    }
    contract ??= resolveJsonApiFieldsetContract(resource);
    namedTypes ??= new Set(contract.resourceTypes);
    if (namedTypes.size < 1 || !contract.primaryType) {
      return;
    }
    const fieldErrors = {};
    for (const [type, value] of Object.entries(fields)) {
      if (namedTypes.has(type)) {
        continue;
      }
      const shown = includedTypes.get(type);
      if (!shown) {
        fieldErrors[`fields.${type}`] = fieldsetKeysRefusal(contract, [...new Set([...namedTypes, ...includedTypes.keys()])]);
        continue;
      }
      const unshown = normalizeJsonApiFieldList(value).filter((name) => !shown.has(name));
      if (unshown.length > 0) {
        const params = { type, shown: [...shown].join(", ") || "none", fields: unshown.join(", ") };
        fieldErrors[`fields.${type}`] = {
          code: "crud.query.fieldsNotShown",
          message: `fields[${params.type}] may name only what this read's includes show of ${params.type}: ` +
            `${params.shown}. It names ${params.fields}.`,
          params
        };
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw createValidationError(fieldErrors);
    }
  };
}

function resolveCrudListUsesOrderedCursor(list = {}) {
  const entries = Array.isArray(list.orderBy)
    ? list.orderBy
    : list.orderBy == null
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

/**
 * The query schemas of a CRUD list: cursor, search, record ids, parent filters, list filters, include and fieldsets.
 * @param {object} [options]
 * @param {object} [options.resource]
 * @param {object | null} [options.listFilterQueryValidator]
 * @param {object} [options.searchQueryValidator]
 * @param {object} [options.includeQueryValidator]
 * @param {object} [options.fieldsetsQueryValidator]
 */
function createStandardCrudListQueryValidators({
  // readable-check: allow dependency-default - data: a resource definition
  resource = {},
  listFilterQueryValidator = null,
  searchQueryValidator = listSearchQueryValidator,
  includeQueryValidator = lookupIncludeQueryValidator,
  fieldsetsQueryValidator = jsonApiFieldsetsQueryValidator
} = {}) {
  const resolvedListFilterQueryValidator =
    listFilterQueryValidator
    ?? resource.contract?.listFilters?.queryValidator
    ?? null;

  return Object.freeze([
    createCrudCursorPaginationQueryValidator({
      orderBy: resource.resource?.defaultSort
    }),
    searchQueryValidator,
    listRecordIdsQueryValidator,
    createCrudParentFilterQueryValidator(resource),
    ...(resolvedListFilterQueryValidator
      ? [resolvedListFilterQueryValidator]
      : []),
    includeQueryValidator,
    fieldsetsQueryValidator
  ]);
}

function createStandardCrudViewQueryValidators({
  includeQueryValidator = lookupIncludeQueryValidator,
  fieldsetsQueryValidator = jsonApiFieldsetsQueryValidator
} = {}) {
  return Object.freeze([
    includeQueryValidator,
    fieldsetsQueryValidator
  ]);
}

export {
  createCrudCursorPaginationQueryValidator,
  createIncludedFieldsetsCheck,
  createJsonApiFieldsetsQueryValidator,
  listSearchQueryValidator,
  listRecordIdsQueryValidator,
  lookupIncludeQueryValidator,
  jsonApiFieldsetsQueryValidator,
  createCrudParentFilterQueryValidator,
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
};
