import { isRecord, normalizeArray, normalizeLowerText, normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { resolveJsonApiTransportTypes } from "./jsonApiTransport.js";
import {
  STANDARD_ERROR_STATUS_CODES,
  buildTransportResponseSchema
} from "./errorResponses.js";
import { createEmbeddableTransportSchemaDocument } from "./transportSchemaEmbedding.js";

const JSON_API_ID_SCHEMA = Object.freeze({
  anyOf: [
    { type: "string", minLength: 1 },
    { type: "number" }
  ]
});

const JSON_API_LINK_VALUE_SCHEMA = Object.freeze({
  anyOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      additionalProperties: true
    }
  ]
});

const JSON_API_LINKS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: JSON_API_LINK_VALUE_SCHEMA
});

const JSON_API_META_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true
});

const JSON_API_RESOURCE_IDENTIFIER_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["type", "id"],
  properties: {
    type: { type: "string", minLength: 1 },
    id: JSON_API_ID_SCHEMA
  }
});

const JSON_API_RELATIONSHIP_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["data"],
  properties: {
    data: {
      anyOf: [
        JSON_API_RESOURCE_IDENTIFIER_SCHEMA,
        {
          type: "array",
          items: JSON_API_RESOURCE_IDENTIFIER_SCHEMA
        },
        { type: "null" }
      ]
    }
  }
});

const JSON_API_INCLUDED_RESOURCE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["type", "id"],
  properties: {
    type: { type: "string", minLength: 1 },
    id: JSON_API_ID_SCHEMA,
    attributes: {
      type: "object",
      additionalProperties: true
    },
    relationships: {
      type: "object",
      additionalProperties: JSON_API_RELATIONSHIP_OBJECT_SCHEMA
    },
    links: JSON_API_LINKS_SCHEMA,
    meta: JSON_API_META_SCHEMA
  }
});

const JSON_API_ERROR_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", minLength: 1 },
    code: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    detail: { type: "string", minLength: 1 },
    source: {
      type: "object",
      additionalProperties: true
    },
    links: JSON_API_LINKS_SCHEMA,
    meta: JSON_API_META_SCHEMA
  }
});

const JSON_API_ERROR_DOCUMENT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["errors"],
  properties: {
    errors: {
      type: "array",
      minItems: 1,
      items: JSON_API_ERROR_OBJECT_SCHEMA
    },
    links: JSON_API_LINKS_SCHEMA,
    meta: JSON_API_META_SCHEMA
  }
});

function resolveRouteType(type = "") {
  const normalizedType = String(type || "").trim();
  if (!normalizedType) {
    throw new TypeError("JSON:API resource transport requires a non-empty type.");
  }
  return normalizedType;
}

function resolveRouteTypes(value = {}) {
  const resolvedTypes = resolveJsonApiTransportTypes(value, {
    context: "JSON:API resource transport"
  });

  return Object.freeze({
    requestType: resolvedTypes.requestType ? resolveRouteType(resolvedTypes.requestType) : "",
    responseType: resolvedTypes.responseType ? resolveRouteType(resolvedTypes.responseType) : ""
  });
}

function resolveEmbeddedAttributesTransportSchema(definition, {
  context = "JSON:API resource",
  defaultMode = "replace",
  removeId = false,
  removeKeys = [],
  allowSparseFields = false
} = {}) {
  const transportSchema = resolveSchemaTransportSchemaDefinition(definition, {
    context,
    defaultMode
  });

  if (!isRecord(transportSchema)) {
    throw new TypeError(`${context} transport schema must resolve to an object schema.`);
  }

  const sourceSchema = normalizeObject(transportSchema);
  const properties = normalizeObject(sourceSchema.properties);
  const nextProperties = {
    ...properties
  };
  const excludedKeys = new Set(
    normalizeArray(removeKeys)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
  );

  if (removeId) {
    excludedKeys.add("id");
  }

  for (const key of excludedKeys) {
    delete nextProperties[key];
  }

  const schemaFieldDefinitions = definition.schema.getFieldDefinitions();

  const required = allowSparseFields !== true && Array.isArray(sourceSchema.required)
    ? sourceSchema.required.filter((entry) => {
        const normalizedEntry = String(entry || "").trim();
        if (!normalizedEntry || excludedKeys.has(normalizedEntry)) {
          return false;
        }

        const fieldDefinition = normalizeObject(schemaFieldDefinitions[normalizedEntry]);
        return fieldDefinition.nullable !== true;
      })
    : [];

  const attributeSchema = {
    ...sourceSchema,
    type: "object",
    properties: nextProperties
  };

  if (required.length > 0) {
    attributeSchema.required = required;
  } else {
    delete attributeSchema.required;
  }

  return createEmbeddableTransportSchemaDocument(attributeSchema, `${normalizeText(context, { fallback: "JsonApiAttributes" }).replace(/[^a-z0-9]+/gi, "_")}`);
}

function normalizeRelationshipSchemaEntries(entries = []) {
  const normalizedEntries = [];

  for (const entry of normalizeArray(entries)) {
    const source = normalizeObject(entry);
    const relationshipName = normalizeText(source.relationshipName || source.name);
    const relationshipType = normalizeText(source.relationshipType || source.type);
    const attributeKey = normalizeText(source.attributeKey || source.fieldKey);
    if (!relationshipName) {
      continue;
    }

    normalizedEntries.push(Object.freeze({
      relationshipName,
      relationshipType,
      attributeKey,
      many: source.many === true,
      required: source.required === true,
      nullable: source.nullable === true
    }));
  }

  return Object.freeze(normalizedEntries);
}

function buildJsonApiRelationshipDataSchema(relationshipType = "", {
  many = false,
  nullable = false
} = {}) {
  const normalizedRelationshipType = normalizeText(relationshipType);
  const resourceIdentifierSchema = normalizedRelationshipType
    ? {
        type: "object",
        additionalProperties: false,
        required: ["type", "id"],
        properties: {
          type: { const: normalizedRelationshipType },
          id: JSON_API_ID_SCHEMA
        }
      }
    : JSON_API_RESOURCE_IDENTIFIER_SCHEMA;
  const linkageSchema = many
    ? {
        type: "array",
        items: resourceIdentifierSchema
      }
    : resourceIdentifierSchema;

  return {
    anyOf: nullable
      ? [
          linkageSchema,
          { type: "null" }
        ]
      : [linkageSchema]
  };
}

function buildJsonApiRelationshipsTransportSchema(entries = [], {
  includeRequired = false
} = {}) {
  const relationshipEntries = normalizeRelationshipSchemaEntries(entries);
  if (relationshipEntries.length < 1) {
    return null;
  }

  const properties = {};
  const required = [];

  for (const entry of relationshipEntries) {
    properties[entry.relationshipName] = {
      type: "object",
      additionalProperties: false,
      required: ["data"],
      properties: {
        data: buildJsonApiRelationshipDataSchema(entry.relationshipType, {
          many: entry.many,
          nullable: entry.nullable
        })
      }
    };

    if (includeRequired && entry.required) {
      required.push(entry.relationshipName);
    }
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties
  };
  if (required.length > 0) {
    schema.required = required;
  }

  return Object.freeze({
    schema,
    entries: relationshipEntries
  });
}

/**
 * The schema of one JSON:API resource object, with its attributes and relationships.
 * @param {object} options
 * @param {string} options.type
 * @param {object} options.attributes The attributes schema.
 * @param {boolean} [options.requireId]
 * @param {boolean} [options.includeLinks]
 * @param {boolean} [options.includeMeta]
 * @param {string[]} [options.excludeAttributeKeys]
 * @param {object[]} [options.relationshipEntries]
 * @param {boolean} [options.relationshipMembersRequired]
 * @param {boolean} [options.allowSparseFields]
 */
function buildJsonApiResourceObjectTransportSchema({
  type = "",
  attributes,
  requireId = true,
  includeLinks = false,
  includeMeta = false,
  // readable-check: allow dependency-default - data: a list of attribute keys, not a collaborator
  excludeAttributeKeys = [],
  // readable-check: allow dependency-default - data: a list of relationship entries, not a collaborator
  relationshipEntries = [],
  relationshipMembersRequired = false,
  allowSparseFields = false
}) {
  return buildResourceObjectTransportSchema({
    normalizedType: resolveRouteType(type),
    attributes,
    requireId,
    includeLinks,
    includeMeta,
    excludeAttributeKeys,
    relationshipEntries,
    relationshipMembersRequired,
    allowSparseFields
  });
}

/**
 * The resource object schema of buildJsonApiResourceObjectTransportSchema, for a type
 * already resolved.
 * @param {object} options
 * @param {string} options.normalizedType
 * @param {object} options.attributes
 * @param {boolean} options.requireId
 * @param {boolean} options.includeLinks
 * @param {boolean} options.includeMeta
 * @param {ReadonlyArray<string>} options.excludeAttributeKeys
 * @param {ReadonlyArray<object>} options.relationshipEntries
 * @param {boolean} options.relationshipMembersRequired
 * @param {boolean} options.allowSparseFields
 */
function buildResourceObjectTransportSchema({
  normalizedType,
  attributes,
  requireId,
  includeLinks,
  includeMeta,
  excludeAttributeKeys,
  relationshipEntries,
  relationshipMembersRequired,
  allowSparseFields
}) {
  const relationshipsTransport = buildJsonApiRelationshipsTransportSchema(relationshipEntries, {
    includeRequired: relationshipMembersRequired
  });
  const relationFieldKeys = relationshipsTransport
    ? relationshipsTransport.entries.map((entry) => entry.attributeKey).filter(Boolean)
    : [];
  const embeddedAttributes = resolveEmbeddedAttributesTransportSchema(attributes, {
    context: `${normalizedType} resource attributes`,
    defaultMode: "replace",
    removeId: true,
    removeKeys: [
      ...normalizeArray(excludeAttributeKeys),
      ...relationFieldKeys,
    ],
    allowSparseFields
  });

  const properties = {
    type: {
      const: normalizedType
    },
    attributes: embeddedAttributes.schema
  };
  const required = allowSparseFields === true ? ["type"] : ["type", "attributes"];

  if (requireId) {
    properties.id = JSON_API_ID_SCHEMA;
    required.push("id");
  }

  if (relationshipsTransport) {
    properties.relationships = relationshipsTransport.schema;
  }

  if (includeLinks) {
    properties.links = JSON_API_LINKS_SCHEMA;
  }
  if (includeMeta) {
    properties.meta = JSON_API_META_SCHEMA;
  }

  return {
    schema: {
      type: "object",
      additionalProperties: false,
      required,
      properties
    },
    definitions: embeddedAttributes.definitions,
    hasRelationships: Boolean(relationshipsTransport)
  };
}

/**
 * The schema of a JSON:API request body that carries one resource object.
 * @param {object} options
 * @param {string} options.type
 * @param {object} options.attributes The attributes schema.
 * @param {boolean} [options.requireId]
 * @param {string[]} [options.excludeAttributeKeys]
 * @param {object[]} [options.relationshipEntries]
 */
function buildJsonApiResourceRequestBodyTransportSchema({
  type = "",
  attributes,
  requireId = false,
  // readable-check: allow dependency-default - data: a list of attribute keys, not a collaborator
  excludeAttributeKeys = [],
  // readable-check: allow dependency-default - data: a list of relationship entries, not a collaborator
  relationshipEntries = []
}) {
  const normalizedType = resolveRouteType(type);
  const resourceTransport = buildResourceObjectTransportSchema({
    normalizedType,
    attributes,
    requireId,
    includeLinks: false,
    includeMeta: false,
    excludeAttributeKeys,
    relationshipEntries,
    relationshipMembersRequired: true,
    allowSparseFields: false
  });
  const embeddedResource = createEmbeddableTransportSchemaDocument(
    {
      ...resourceTransport.schema,
      definitions: resourceTransport.definitions
    },
    `${normalizedType}RequestResource`
  );

  return {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
      data: embeddedResource.schema
    },
    definitions: embeddedResource.definitions
  };
}

function buildJsonApiMetaSuccessTransportSchema({
  meta
} = {}) {
  const embeddedMeta = resolveEmbeddedAttributesTransportSchema(meta, {
    context: "JSON:API success meta",
    defaultMode: "replace",
    removeId: false
  });

  return {
    type: "object",
    additionalProperties: false,
    required: ["meta"],
    properties: {
      meta: embeddedMeta.schema
    },
    definitions: embeddedMeta.definitions
  };
}

/**
 * The schema of a JSON:API success document: one record, a nullable record, a
 * collection or meta only.
 * @param {object} options
 * @param {string} options.type
 * @param {object} options.attributes The attributes schema, or the meta schema for kind meta.
 * @param {string} [options.kind] record, nullable-record, collection or meta.
 * @param {boolean} [options.includeLinks]
 * @param {boolean} [options.includeMeta]
 * @param {boolean} [options.includeIncluded]
 * @param {boolean} [options.allowSparseFields]
 * @param {string[]} [options.excludeAttributeKeys]
 * @param {object[]} [options.relationshipEntries]
 */
function buildJsonApiResourceSuccessTransportSchema({
  type = "",
  attributes,
  kind = "record",
  includeLinks = false,
  includeMeta = false,
  includeIncluded = false,
  allowSparseFields = false,
  // readable-check: allow dependency-default - data: a list of attribute keys, not a collaborator
  excludeAttributeKeys = [],
  // readable-check: allow dependency-default - data: a list of relationship entries, not a collaborator
  relationshipEntries = []
}) {
  const normalizedKind = normalizeLowerText(kind);
  if (!["record", "nullable-record", "collection", "meta"].includes(normalizedKind)) {
    throw new TypeError(`Unsupported JSON:API success schema kind: ${normalizedKind || "<empty>"}.`);
  }

  if (normalizedKind === "meta") {
    return buildJsonApiMetaSuccessTransportSchema({
      meta: attributes
    });
  }

  const normalizedType = resolveRouteType(type);
  const resourceTransport = buildResourceObjectTransportSchema({
    normalizedType,
    attributes,
    requireId: true,
    includeLinks: false,
    includeMeta: false,
    excludeAttributeKeys,
    relationshipEntries,
    relationshipMembersRequired: false,
    allowSparseFields
  });
  const embeddedResource = createEmbeddableTransportSchemaDocument(
    {
      ...resourceTransport.schema,
      definitions: resourceTransport.definitions
    },
    `${normalizedType}SuccessResource`
  );

  const documentProperties = {};
  const documentDefinitions = { ...embeddedResource.definitions };

  if (normalizedKind === "collection") {
    documentProperties.data = {
      type: "array",
      items: embeddedResource.schema
    };
  } else if (normalizedKind === "nullable-record") {
    documentProperties.data = {
      anyOf: [
        { type: "null" },
        embeddedResource.schema
      ]
    };
  } else {
    documentProperties.data = embeddedResource.schema;
  }

  if (includeIncluded || resourceTransport.hasRelationships) {
    documentProperties.included = {
      type: "array",
      items: JSON_API_INCLUDED_RESOURCE_SCHEMA
    };
  }
  if (includeLinks) {
    documentProperties.links = JSON_API_LINKS_SCHEMA;
  }
  if (includeMeta) {
    documentProperties.meta = JSON_API_META_SCHEMA;
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: documentProperties,
    definitions: documentDefinitions
  };
}

function withJsonApiErrorResponses(successResponses, { includeValidation400 = false } = {}) {
  const responses = {
    ...normalizeObject(successResponses)
  };

  for (const statusCode of STANDARD_ERROR_STATUS_CODES) {
    if (responses[statusCode]) {
      continue;
    }

    if (statusCode === 400 && !includeValidation400) {
      continue;
    }

    responses[statusCode] = buildTransportResponseSchema(JSON_API_ERROR_DOCUMENT_SCHEMA);
  }

  return responses;
}

export {
  JSON_API_ERROR_DOCUMENT_SCHEMA,
  resolveRouteTypes,
  buildJsonApiResourceObjectTransportSchema,
  buildJsonApiResourceRequestBodyTransportSchema,
  buildJsonApiResourceSuccessTransportSchema,
  withJsonApiErrorResponses
};
