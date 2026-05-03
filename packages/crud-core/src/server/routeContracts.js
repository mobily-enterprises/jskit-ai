import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator as defaultListSearchQueryValidator,
  lookupIncludeQueryValidator as defaultLookupIncludeQueryValidator,
  createCrudParentFilterQueryValidator
} from "./listQueryValidators.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveSchemaFieldDefinitions(definition = null) {
  const schema = definition?.schema;
  if (!schema || typeof schema.getFieldDefinitions !== "function") {
    return {};
  }

  const definitions = schema.getFieldDefinitions();
  return isRecord(definitions) ? definitions : {};
}

function resolveJsonApiRelationshipEntries(definition = null) {
  const entries = [];

  for (const [fieldKey, fieldDefinition] of Object.entries(resolveSchemaFieldDefinitions(definition))) {
    const normalizedFieldDefinition = isRecord(fieldDefinition) ? fieldDefinition : {};
    const relationshipType = String(normalizedFieldDefinition.belongsTo || "").trim();
    if (!relationshipType) {
      continue;
    }

    const relationshipName = String(normalizedFieldDefinition.as || fieldKey || "").trim();
    if (!relationshipName) {
      continue;
    }

    entries.push(Object.freeze({
      attributeKey: fieldKey,
      relationshipName,
      relationshipType,
      required: normalizedFieldDefinition.required === true,
      nullable: normalizedFieldDefinition.nullable === true
    }));
  }

  return Object.freeze(entries);
}

function createRecordAttributesResolver(definition = null, {
  excludeKeys = []
} = {}) {
  const relationshipEntries = resolveJsonApiRelationshipEntries(definition);
  const excludedKeys = new Set(
    relationshipEntries
      .map((entry) => String(entry.attributeKey || "").trim())
      .filter(Boolean)
  );

  for (const key of excludeKeys) {
    const normalizedKey = String(key || "").trim();
    if (normalizedKey) {
      excludedKeys.add(normalizedKey);
    }
  }

  if (excludedKeys.size < 1) {
    return null;
  }

  return function getRecordAttributes(record = {}) {
    if (!isRecord(record)) {
      return {};
    }

    const attributes = {
      ...record
    };
    delete attributes.id;
    for (const key of excludedKeys) {
      delete attributes[key];
    }
    return attributes;
  };
}

function createRecordRelationshipsResolver(definition = null) {
  const relationshipEntries = resolveJsonApiRelationshipEntries(definition);
  if (relationshipEntries.length < 1) {
    return null;
  }

  return function getRecordRelationships(record = {}) {
    if (!isRecord(record)) {
      return undefined;
    }

    const relationships = {};

    for (const entry of relationshipEntries) {
      if (!Object.hasOwn(record, entry.attributeKey)) {
        continue;
      }

      const value = record[entry.attributeKey];
      relationships[entry.relationshipName] = {
        data: value == null || (typeof value === "string" && value.trim() === "")
          ? null
          : {
              type: entry.relationshipType,
              id: String(value)
            }
      };
    }

    return Object.keys(relationships).length > 0 ? relationships : undefined;
  };
}

function createRequestRelationshipMapper(definition = null) {
  const relationshipEntries = resolveJsonApiRelationshipEntries(definition);
  if (relationshipEntries.length < 1) {
    return null;
  }

  return function mapRequestRelationships(relationships = {}) {
    const source = isRecord(relationships) ? relationships : {};
    const mapped = {};

    for (const entry of relationshipEntries) {
      if (!Object.hasOwn(source, entry.relationshipName)) {
        continue;
      }

      const relationship = isRecord(source[entry.relationshipName])
        ? source[entry.relationshipName]
        : {};
      const data = relationship.data;

      if (data == null) {
        mapped[entry.attributeKey] = null;
        continue;
      }

      if (isRecord(data) && data.id != null && String(data.id).trim()) {
        mapped[entry.attributeKey] = data.id;
      }
    }

    return mapped;
  };
}

function resolveOutputAttributeExcludeKeys(resource = {}) {
  const lookupContainerKey = String(resource?.contract?.lookup?.containerKey || "").trim();
  return lookupContainerKey ? Object.freeze([lookupContainerKey]) : Object.freeze([]);
}

function createCrudJsonApiRouteContracts({
  resource = {},
  routeParamsValidator = null,
  listSearchQueryValidator = defaultListSearchQueryValidator,
  lookupIncludeQueryValidator = defaultLookupIncludeQueryValidator
} = {}) {
  const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator({
    orderBy: resource?.defaultSort
  });
  const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(resource);
  const listRouteQueryValidator = composeSchemaDefinitions([
    listCursorPaginationQueryValidator,
    listSearchQueryValidator,
    listParentFilterQueryValidator,
    lookupIncludeQueryValidator
  ]);
  const recordRouteParamsValidator = routeParamsValidator
    ? composeSchemaDefinitions([
        routeParamsValidator,
        recordIdParamsValidator
      ])
    : recordIdParamsValidator;
  const routeType = resource?.namespace;
  const viewOutput = resource?.operations?.view?.output;
  const createBody = resource?.operations?.create?.body;
  const createOutput = resource?.operations?.create?.output;
  const patchBody = resource?.operations?.patch?.body;
  const patchOutput = resource?.operations?.patch?.output;
  const outputAttributeExcludeKeys = resolveOutputAttributeExcludeKeys(resource);
  const viewOutputRelationships = resolveJsonApiRelationshipEntries(viewOutput);
  const createBodyRelationships = resolveJsonApiRelationshipEntries(createBody);
  const createOutputRelationships = resolveJsonApiRelationshipEntries(createOutput);
  const patchBodyRelationships = resolveJsonApiRelationshipEntries(patchBody);
  const patchOutputRelationships = resolveJsonApiRelationshipEntries(patchOutput);
  const viewRecordAttributes = createRecordAttributesResolver(viewOutput, {
    excludeKeys: outputAttributeExcludeKeys
  });
  const viewRecordRelationships = createRecordRelationshipsResolver(viewOutput);
  const createRecordAttributes = createRecordAttributesResolver(createOutput, {
    excludeKeys: outputAttributeExcludeKeys
  });
  const createRecordRelationships = createRecordRelationshipsResolver(createOutput);
  const patchRecordAttributes = createRecordAttributesResolver(patchOutput, {
    excludeKeys: outputAttributeExcludeKeys
  });
  const patchRecordRelationships = createRecordRelationshipsResolver(patchOutput);
  const createRequestRelationships = createRequestRelationshipMapper(createBody);
  const patchRequestRelationships = createRequestRelationshipMapper(patchBody);

  return Object.freeze({
    listRouteContract: createJsonApiResourceRouteContract({
      type: routeType,
      query: listRouteQueryValidator,
      output: viewOutput,
      outputKind: "collection",
      outputAttributeExcludeKeys,
      outputRelationshipEntries: viewOutputRelationships,
      getRecordAttributes: viewRecordAttributes,
      getRecordRelationships: viewRecordRelationships
    }),
    viewRouteContract: createJsonApiResourceRouteContract({
      type: routeType,
      query: lookupIncludeQueryValidator,
      output: viewOutput,
      outputKind: "record",
      outputAttributeExcludeKeys,
      outputRelationshipEntries: viewOutputRelationships,
      getRecordAttributes: viewRecordAttributes,
      getRecordRelationships: viewRecordRelationships
    }),
    createRouteContract: createJsonApiResourceRouteContract({
      type: routeType,
      body: createBody,
      output: createOutput,
      outputKind: "record",
      successStatus: 201,
      includeValidation400: true,
      bodyRelationshipEntries: createBodyRelationships,
      outputAttributeExcludeKeys,
      outputRelationshipEntries: createOutputRelationships,
      mapRequestRelationships: createRequestRelationships,
      getRecordAttributes: createRecordAttributes,
      getRecordRelationships: createRecordRelationships
    }),
    updateRouteContract: createJsonApiResourceRouteContract({
      type: routeType,
      body: patchBody,
      output: patchOutput,
      outputKind: "record",
      includeValidation400: true,
      bodyRelationshipEntries: patchBodyRelationships,
      outputAttributeExcludeKeys,
      outputRelationshipEntries: patchOutputRelationships,
      mapRequestRelationships: patchRequestRelationships,
      getRecordAttributes: patchRecordAttributes,
      getRecordRelationships: patchRecordRelationships
    }),
    deleteRouteContract: createJsonApiResourceRouteContract({
      type: routeType,
      outputKind: "no-content",
      successStatus: 204
    }),
    recordRouteParamsValidator
  });
}

export { createCrudJsonApiRouteContracts };
