import { normalizeArray } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  resolveSchemaTransportSchemaDefinition
} from "@jskit-ai/kernel/shared/validators";
import {
  JSON_API_CONTENT_TYPE,
  createJsonApiDocument,
  createJsonApiErrorDocumentFromFailure,
  createJsonApiResourceObject,
  normalizeJsonApiDocument,
  resolveJsonApiTransportTypes
} from "./jsonApiTransport.js";
import {
  isJsonApiDataResult,
  isJsonApiDocumentResult,
  isJsonApiMetaResult,
  unwrapJsonApiResult
} from "./jsonApiResult.js";
import {
  createJsonApiResourceQueryTransportSchema,
  decodeJsonApiResourceQueryObject
} from "./jsonApiQueryTransport.js";
import {
  STANDARD_ERROR_STATUS_CODES,
  createTransportResponseSchema
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createJsonApiTransportError(statusCode, message, code) {
  const error = new Error(String(message || "JSON:API transport error."));
  error.status = Number(statusCode) || 500;
  error.statusCode = error.status;
  error.code = String(code || "jsonapi_transport_error").trim() || "jsonapi_transport_error";
  return error;
}

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
  removeKeys = []
} = {}) {
  const transportSchema = resolveSchemaTransportSchemaDefinition(definition, {
    context,
    defaultMode
  });

  if (!transportSchema || typeof transportSchema !== "object" || Array.isArray(transportSchema)) {
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

  const schemaFieldDefinitions = (() => {
    const fieldDefinitions = definition?.schema?.getFieldDefinitions?.();
    return isRecord(fieldDefinitions) ? fieldDefinitions : {};
  })();

  const required = Array.isArray(sourceSchema.required)
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
      required: source.required === true,
      nullable: source.nullable === true
    }));
  }

  return Object.freeze(normalizedEntries);
}

function createJsonApiRelationshipDataSchema(relationshipType = "", {
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

  return {
    anyOf: nullable
      ? [
          resourceIdentifierSchema,
          { type: "null" }
        ]
      : [resourceIdentifierSchema]
  };
}

function createJsonApiRelationshipsTransportSchema(entries = [], {
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
        data: createJsonApiRelationshipDataSchema(entry.relationshipType, {
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

function createJsonApiResourceObjectTransportSchema({
  type = "",
  attributes,
  requireId = true,
  includeLinks = false,
  includeMeta = false,
  excludeAttributeKeys = [],
  relationshipEntries = [],
  relationshipMembersRequired = false
} = {}) {
  const normalizedType = resolveRouteType(type);
  const relationshipsTransport = createJsonApiRelationshipsTransportSchema(relationshipEntries, {
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
    ]
  });

  const properties = {
    type: {
      const: normalizedType
    },
    attributes: embeddedAttributes.schema
  };
  const required = ["type", "attributes"];

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

function createJsonApiResourceRequestBodyTransportSchema({
  type = "",
  attributes,
  requireId = false,
  excludeAttributeKeys = [],
  relationshipEntries = []
} = {}) {
  const resourceTransport = createJsonApiResourceObjectTransportSchema({
    type,
    attributes,
    requireId,
    excludeAttributeKeys,
    relationshipEntries,
    relationshipMembersRequired: true
  });
  const embeddedResource = createEmbeddableTransportSchemaDocument(
    {
      ...resourceTransport.schema,
      definitions: resourceTransport.definitions
    },
    `${resolveRouteType(type)}RequestResource`
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

function createJsonApiMetaSuccessTransportSchema({
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

function createJsonApiResourceSuccessTransportSchema({
  type = "",
  attributes,
  kind = "record",
  includeLinks = false,
  includeMeta = false,
  includeIncluded = false,
  excludeAttributeKeys = [],
  relationshipEntries = []
} = {}) {
  const normalizedKind = String(kind || "record").trim().toLowerCase();
  if (!["record", "nullable-record", "collection", "meta"].includes(normalizedKind)) {
    throw new TypeError(`Unsupported JSON:API success schema kind: ${normalizedKind || "<empty>"}.`);
  }

  if (normalizedKind === "meta") {
    return createJsonApiMetaSuccessTransportSchema({
      meta: attributes
    });
  }

  const resourceTransport = createJsonApiResourceObjectTransportSchema({
    type,
    attributes,
    requireId: true,
    excludeAttributeKeys,
    relationshipEntries
  });
  const embeddedResource = createEmbeddableTransportSchemaDocument(
    {
      ...resourceTransport.schema,
      definitions: resourceTransport.definitions
    },
    `${resolveRouteType(type)}SuccessResource`
  );

  const documentProperties = {};
  const documentDefinitions = {
    ...resourceTransport.definitions,
    ...embeddedResource.definitions
  };

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

    responses[statusCode] = createTransportResponseSchema(JSON_API_ERROR_DOCUMENT_SCHEMA);
  }

  return responses;
}

function defaultRecordTypeResolver(type) {
  return function resolveRecordType() {
    return type;
  };
}

function defaultRecordIdResolver(record = {}) {
  if (!isRecord(record) || record.id == null || String(record.id).trim() === "") {
    throw createJsonApiTransportError(500, "JSON:API resource response requires record.id.", "jsonapi_record_id_missing");
  }

  return record.id;
}

function defaultRecordAttributesResolver(record = {}) {
  if (!isRecord(record)) {
    return {};
  }

  const attributes = {
    ...record
  };
  delete attributes.id;
  return attributes;
}

function defaultCollectionItemsResolver(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return Array.isArray(payload?.items) ? payload.items : [];
}

function defaultCollectionMetaResolver(payload) {
  const nextCursor = String(payload?.nextCursor || "").trim();
  if (!nextCursor) {
    return undefined;
  }

  return {
    page: {
      nextCursor
    }
  };
}

function assertJsonApiSuccessResult(payload) {
  const result = unwrapJsonApiResult(payload);
  if (!result) {
    throw createJsonApiTransportError(
      500,
      "JSON:API route success payload must be returned with an explicit JSON:API result wrapper.",
      "jsonapi_success_result_missing"
    );
  }

  return result;
}

function createJsonApiResourceRouteTransport({
  type = "",
  requestType = "",
  responseType = "",
  query = null,
  allowBodyId = false,
  successKind = "record",
  pointerPrefix = "/data/attributes",
  mapRequestRelationships = null,
  getRecordType = null,
  getRecordId = null,
  getRecordAttributes = null,
  getRecordRelationships = null,
  getRecordLinks = null,
  getRecordMeta = null,
  getIncluded = null,
  getDocumentLinks = null,
  getDocumentMeta = null,
  getCollectionItems = null
} = {}) {
  const resolvedTypes = resolveRouteTypes({
    type,
    requestType,
    responseType
  });
  const normalizedRequestType = resolvedTypes.requestType;
  const normalizedResponseType = resolvedTypes.responseType;
  const normalizedSuccessKind = String(successKind || "record").trim().toLowerCase();

  const resolveRecordType = typeof getRecordType === "function" ? getRecordType : defaultRecordTypeResolver(normalizedResponseType);
  const resolveRecordId = typeof getRecordId === "function" ? getRecordId : defaultRecordIdResolver;
  const resolveRecordAttributes = typeof getRecordAttributes === "function" ? getRecordAttributes : defaultRecordAttributesResolver;
  const resolveCollectionItems = typeof getCollectionItems === "function" ? getCollectionItems : defaultCollectionItemsResolver;
  const resolveDocumentMeta = typeof getDocumentMeta === "function" ? getDocumentMeta : defaultCollectionMetaResolver;

  function buildResourceObject(record, context) {
    if (!isRecord(record)) {
      throw createJsonApiTransportError(500, "JSON:API resource response requires an object record.", "jsonapi_record_invalid");
    }

    const resourceOptions = {
      type: resolveRecordType(record, context),
      id: resolveRecordId(record, context),
      attributes: resolveRecordAttributes(record, context)
    };

    if (typeof getRecordRelationships === "function") {
      const relationships = getRecordRelationships(record, context);
      if (relationships !== undefined) {
        resourceOptions.relationships = relationships;
      }
    }
    if (typeof getRecordLinks === "function") {
      const links = getRecordLinks(record, context);
      if (links !== undefined) {
        resourceOptions.links = links;
      }
    }
    if (typeof getRecordMeta === "function") {
      const meta = getRecordMeta(record, context);
      if (meta !== undefined) {
        resourceOptions.meta = meta;
      }
    }

    return createJsonApiResourceObject(resourceOptions);
  }

  return Object.freeze({
    kind: "jsonapi-resource",
    contentType: JSON_API_CONTENT_TYPE,
    request: {
      body(payload) {
        if (!normalizedRequestType) {
          throw createJsonApiTransportError(500, "JSON:API request transport requires requestType for body parsing.", "jsonapi_request_type_missing");
        }

        const document = normalizeJsonApiDocument(payload);
        if (document.kind !== "resource" || document.data == null) {
          throw createJsonApiTransportError(400, "JSON:API request body must contain a resource document.", "jsonapi_request_body_invalid");
        }

        if (String(document.data.type || "").trim() !== normalizedRequestType) {
          throw createJsonApiTransportError(409, `JSON:API resource type must be ${normalizedRequestType}.`, "jsonapi_request_type_mismatch");
        }

        const nextBody = {
          ...(document.data.attributes || {})
        };

        if (allowBodyId && document.data.id != null && String(document.data.id).trim()) {
          nextBody.id = document.data.id;
        }

        if (typeof mapRequestRelationships === "function") {
          Object.assign(nextBody, mapRequestRelationships(document.data.relationships || {}, {
            payload,
            document
          }) || {});
        }

        return nextBody;
      },
      query(payload) {
        if (!query) {
          return payload;
        }

        return decodeJsonApiResourceQueryObject(payload, {
          responseType: normalizedResponseType
        });
      }
    },
    response(payload, context = {}) {
      if (normalizedSuccessKind === "no-content" || Number(context?.statusCode || 200) === 204) {
        return undefined;
      }

      const result = assertJsonApiSuccessResult(payload);

      if (isJsonApiDocumentResult(result)) {
        const document = normalizeJsonApiDocument(result.value);
        if (document.kind === "unknown") {
          throw createJsonApiTransportError(
            500,
            "JSON:API document result must contain a valid JSON:API document.",
            "jsonapi_document_result_invalid"
          );
        }

        if (normalizedSuccessKind === "collection" && document.kind !== "collection") {
          throw createJsonApiTransportError(
            500,
            "JSON:API collection route requires a collection document result.",
            "jsonapi_document_result_kind_mismatch"
          );
        }

        if (
          (normalizedSuccessKind === "record" || normalizedSuccessKind === "nullable-record") &&
          document.kind !== "resource"
        ) {
          throw createJsonApiTransportError(
            500,
            "JSON:API record route requires a resource document result.",
            "jsonapi_document_result_kind_mismatch"
          );
        }

        if (normalizedSuccessKind === "meta" && document.kind !== "meta") {
          throw createJsonApiTransportError(
            500,
            "JSON:API meta route requires a meta-only document result.",
            "jsonapi_document_result_kind_mismatch"
          );
        }

        return result.value;
      }

      if (normalizedSuccessKind === "meta") {
        if (isJsonApiMetaResult(result)) {
          return createJsonApiDocument({
            meta: result.value
          });
        }

        throw createJsonApiTransportError(
          500,
          "JSON:API meta route requires a meta result.",
          "jsonapi_meta_result_missing"
        );
      }

      if (!isJsonApiDataResult(result)) {
        throw createJsonApiTransportError(
          500,
          "JSON:API resource route requires a data or document result.",
          "jsonapi_success_result_kind_invalid"
        );
      }

      const sourcePayload = result.value;

      if (normalizedSuccessKind === "collection") {
        const items = normalizeArray(resolveCollectionItems(sourcePayload, context));
        const documentOptions = {
          data: items.map((entry) => buildResourceObject(entry, context))
        };

        if (typeof getIncluded === "function") {
          const included = normalizeArray(getIncluded(sourcePayload, context));
          if (included.length > 0) {
            documentOptions.included = included;
          }
        }

        const links = typeof getDocumentLinks === "function" ? getDocumentLinks(sourcePayload, context) : undefined;
        if (links !== undefined) {
          documentOptions.links = links;
        }

        const meta = resolveDocumentMeta(sourcePayload, context);
        if (meta !== undefined) {
          documentOptions.meta = meta;
        }

        return createJsonApiDocument(documentOptions);
      }

      if (sourcePayload == null) {
        if (normalizedSuccessKind === "nullable-record") {
          return createJsonApiDocument({
            data: null
          });
        }

        throw createJsonApiTransportError(500, "JSON:API resource response requires a record payload.", "jsonapi_record_missing");
      }

      const documentOptions = {
        data: buildResourceObject(sourcePayload, context)
      };

      if (typeof getIncluded === "function") {
        const included = normalizeArray(getIncluded(sourcePayload, context));
        if (included.length > 0) {
          documentOptions.included = included;
        }
      }

      if (typeof getDocumentLinks === "function") {
        const links = getDocumentLinks(sourcePayload, context);
        if (links !== undefined) {
          documentOptions.links = links;
        }
      }

      if (typeof getDocumentMeta === "function") {
        const meta = getDocumentMeta(sourcePayload, context);
        if (meta !== undefined) {
          documentOptions.meta = meta;
        }
      }

      return createJsonApiDocument(documentOptions);
    },
    error(error, {
      statusCode = 500,
      code = ""
    } = {}) {
      const fieldErrors = isRecord(error?.fieldErrors)
        ? error.fieldErrors
        : isRecord(error?.details?.fieldErrors)
          ? error.details.fieldErrors
          : {};

      return createJsonApiErrorDocumentFromFailure({
        statusCode,
        code,
        message: error?.message,
        fieldErrors,
        validationIssues: Array.isArray(error?.validation) ? error.validation : [],
        validationContext: String(error?.validationContext || "").trim(),
        pointerPrefix
      });
    }
  });
}

function createJsonApiResourceRouteContract({
  type = "",
  requestType = "",
  responseType = "",
  body = null,
  query = null,
  output = null,
  outputKind = "record",
  successStatus = 200,
  includeValidation400 = false,
  allowBodyId = false,
  pointerPrefix = "/data/attributes",
  bodyAttributeExcludeKeys = [],
  outputAttributeExcludeKeys = [],
  bodyRelationshipEntries = [],
  outputRelationshipEntries = [],
  getRecordType = null,
  getRecordId = null,
  getRecordAttributes = null,
  getRecordRelationships = null,
  getRecordLinks = null,
  getRecordMeta = null,
  getIncluded = null,
  getDocumentLinks = null,
  getDocumentMeta = null,
  getCollectionItems = null,
  mapRequestRelationships = null
} = {}) {
  const resolvedTypes = resolveRouteTypes({
    type,
    requestType,
    responseType
  });
  const normalizedRequestType = resolvedTypes.requestType;
  const normalizedResponseType = resolvedTypes.responseType;
  const normalizedOutputKind = String(outputKind || "record").trim().toLowerCase();
  const statusCode = Number(successStatus);

  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode > 299) {
    throw new TypeError("JSON:API resource route contract requires a 2xx successStatus.");
  }

  const transport = createJsonApiResourceRouteTransport({
      requestType: normalizedRequestType,
      responseType: normalizedResponseType,
      query,
      allowBodyId,
      successKind: normalizedOutputKind,
      pointerPrefix,
      getRecordType,
      getRecordId,
      getRecordAttributes,
      getRecordRelationships,
      getRecordLinks,
      getRecordMeta,
      getIncluded,
      getDocumentLinks,
      getDocumentMeta,
      getCollectionItems,
      mapRequestRelationships
    });
  const contract = {
    transport
  };

  const fastifySchema = {};
  if (body) {
    contract.body = body;
    fastifySchema.body = createJsonApiResourceRequestBodyTransportSchema({
      type: normalizedRequestType,
      attributes: body,
      requireId: allowBodyId,
      excludeAttributeKeys: bodyAttributeExcludeKeys,
      relationshipEntries: bodyRelationshipEntries
    });
  }
  if (query) {
    contract.query = query;
    fastifySchema.querystring = createJsonApiResourceQueryTransportSchema({
      query,
      responseType: normalizedResponseType
    });
  }

  if (Object.keys(fastifySchema).length > 0) {
    contract.advanced = {
      fastifySchema
    };
  }

  const successResponses = {};
  if (normalizedOutputKind !== "no-content") {
    if (!output) {
      throw new TypeError(`JSON:API resource route contract for ${normalizedResponseType} requires output schema.`);
    }

    successResponses[statusCode] = createTransportResponseSchema(
      createJsonApiResourceSuccessTransportSchema({
        type: normalizedResponseType,
        attributes: output,
        kind: normalizedOutputKind,
        includeLinks: typeof getDocumentLinks === "function",
        includeMeta: typeof getDocumentMeta === "function" || normalizedOutputKind === "collection",
        includeIncluded: typeof getIncluded === "function",
        excludeAttributeKeys: outputAttributeExcludeKeys,
        relationshipEntries: outputRelationshipEntries
      })
    );
  }

  contract.responses = withJsonApiErrorResponses(successResponses, {
    includeValidation400
  });

  return Object.freeze(contract);
}

export {
  JSON_API_ERROR_DOCUMENT_SCHEMA,
  createJsonApiResourceObjectTransportSchema,
  createJsonApiResourceRequestBodyTransportSchema,
  createJsonApiResourceSuccessTransportSchema,
  withJsonApiErrorResponses,
  createJsonApiResourceRouteTransport,
  createJsonApiResourceRouteContract
};
