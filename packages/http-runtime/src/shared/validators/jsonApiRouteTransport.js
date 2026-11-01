import { isRecord, normalizeArray } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveValidationIssueCode } from "@jskit-ai/kernel/shared/validators";
import {
  JSON_API_CONTENT_TYPE,
  createJsonApiDocument,
  createJsonApiErrorDocumentFromFailure,
  createJsonApiResourceObject,
  normalizeJsonApiDocument
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
import { createTransportResponseSchema } from "./errorResponses.js";
import {
  createJsonApiResourceRequestBodyTransportSchema,
  createJsonApiResourceSuccessTransportSchema,
  resolveRouteTypes,
  withJsonApiErrorResponses
} from "./jsonApiResourceSchemas.js";

function createJsonApiTransportError(statusCode, message, code, params = {}) {
  const error = new Error(String(message || "JSON:API transport error."));
  error.status = Number(statusCode) || 500;
  error.statusCode = error.status;
  error.code = String(code || "jsonapi_transport_error").trim() || "jsonapi_transport_error";
  error.params = params;
  return error;
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

/** The hook of an option the caller leaves out: it adds nothing. */
function resolveNothing() {
  return undefined;
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

/**
 * @typedef {((source: any, context: any) => any) | null | undefined} JsonApiRouteHook
 *   One of a route's response or request hooks; left out (or null), the route uses its default.
 */

/**
 * The JSON:API transport of one resource route: it decodes the request body and query,
 * and encodes the route's result and errors as JSON:API documents.
 * @param {object} options
 * @param {string} [options.type]
 * @param {string} [options.requestType]
 * @param {string} [options.responseType]
 * @param {object} [options.query] The query schema, when the route takes a query.
 * @param {boolean} [options.allowBodyId]
 * @param {string} [options.successKind] record, nullable-record, collection, meta or no-content.
 * @param {string} [options.pointerPrefix]
 * @param {JsonApiRouteHook} [options.mapRequestRelationships]
 * @param {JsonApiRouteHook} [options.getRecordType]
 * @param {JsonApiRouteHook} [options.getRecordId]
 * @param {JsonApiRouteHook} [options.getRecordAttributes]
 * @param {JsonApiRouteHook} [options.getRecordRelationships]
 * @param {JsonApiRouteHook} [options.getRecordLinks]
 * @param {JsonApiRouteHook} [options.getRecordMeta]
 * @param {JsonApiRouteHook} [options.getIncluded]
 * @param {JsonApiRouteHook} [options.getDocumentLinks]
 * @param {JsonApiRouteHook} [options.getDocumentMeta]
 * @param {JsonApiRouteHook} [options.getCollectionItems]
 */
function createJsonApiResourceRouteTransport({
  type = "",
  requestType = "",
  responseType = "",
  query,
  allowBodyId = false,
  successKind = "record",
  pointerPrefix = "/data/attributes",
  mapRequestRelationships,
  getRecordType,
  getRecordId,
  getRecordAttributes,
  getRecordRelationships,
  getRecordLinks,
  getRecordMeta,
  getIncluded,
  getDocumentLinks,
  getDocumentMeta,
  getCollectionItems
}) {
  const resolvedTypes = resolveRouteTypes({
    type,
    requestType,
    responseType
  });
  const normalizedRequestType = resolvedTypes.requestType;
  const normalizedResponseType = resolvedTypes.responseType;
  const normalizedSuccessKind = String(successKind || "record").trim().toLowerCase();

  const resolveRecordType = getRecordType || defaultRecordTypeResolver(normalizedResponseType);
  const resolveRecordId = getRecordId || defaultRecordIdResolver;
  const resolveRecordAttributes = getRecordAttributes || defaultRecordAttributesResolver;
  const resolveRecordRelationships = getRecordRelationships || resolveNothing;
  const resolveRecordLinks = getRecordLinks || resolveNothing;
  const resolveRecordMeta = getRecordMeta || resolveNothing;
  const resolveIncluded = getIncluded || resolveNothing;
  const resolveDocumentLinks = getDocumentLinks || resolveNothing;
  const resolveRecordDocumentMeta = getDocumentMeta || resolveNothing;
  const resolveCollectionMeta = getDocumentMeta || defaultCollectionMetaResolver;
  const resolveCollectionItems = getCollectionItems || defaultCollectionItemsResolver;
  const resolveRequestRelationships = mapRequestRelationships || resolveNothing;

  function buildResourceObject(record, context) {
    if (!isRecord(record)) {
      throw createJsonApiTransportError(500, "JSON:API resource response requires an object record.", "jsonapi_record_invalid");
    }

    const resourceOptions = {
      type: resolveRecordType(record, context),
      id: resolveRecordId(record, context),
      attributes: resolveRecordAttributes(record, context)
    };

    const relationships = resolveRecordRelationships(record, context);
    if (relationships !== undefined) {
      resourceOptions.relationships = relationships;
    }
    const links = resolveRecordLinks(record, context);
    if (links !== undefined) {
      resourceOptions.links = links;
    }
    const meta = resolveRecordMeta(record, context);
    if (meta !== undefined) {
      resourceOptions.meta = meta;
    }

    return createJsonApiResourceObject(resourceOptions);
  }

  /**
   * Collections always resolve meta (falling back to the nextCursor page meta); records add
   * meta only when the caller supplies getDocumentMeta.
   */
  function buildDocumentOptions(sourcePayload, context, data, resolveMeta) {
    const documentOptions = { data };

    const included = normalizeArray(resolveIncluded(sourcePayload, context));
    if (included.length > 0) {
      documentOptions.included = included;
    }

    const links = resolveDocumentLinks(sourcePayload, context);
    if (links !== undefined) {
      documentOptions.links = links;
    }

    const meta = resolveMeta(sourcePayload, context);
    if (meta !== undefined) {
      documentOptions.meta = meta;
    }

    return documentOptions;
  }

  function response(payload, context = {}) {
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
      const documentOptions = buildDocumentOptions(
        sourcePayload,
        context,
        items.map((entry) => buildResourceObject(entry, context)),
        resolveCollectionMeta
      );

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

    const documentOptions = buildDocumentOptions(
      sourcePayload,
      context,
      buildResourceObject(sourcePayload, context),
      resolveRecordDocumentMeta
    );

    return createJsonApiDocument(documentOptions);
  }

  // The kernel error handler decides what is exposed; params and messageCode come
  // from it, and each field or Ajv issue carries its own code.
  function errorDocument(error, {
    statusCode = 500,
    code = "",
    message = error?.message,
    exposeDetails = true,
    params = {},
    messageCode = "",
    messageParams = {}
  } = {}) {
    const fieldErrors = !exposeDetails ? {} : isRecord(error?.fieldErrors)
      ? error.fieldErrors
      : isRecord(error?.details?.fieldErrors)
        ? error.details.fieldErrors
        : {};
    const fieldErrorCodes = !exposeDetails ? {} : isRecord(error?.fieldErrorCodes)
      ? error.fieldErrorCodes
      : isRecord(error?.details?.fieldErrorCodes)
        ? error.details.fieldErrorCodes
        : {};
    const validationIssues = exposeDetails && Array.isArray(error?.validation) ? error.validation : [];

    return createJsonApiErrorDocumentFromFailure({
      statusCode,
      code,
      message,
      params,
      messageCode,
      messageParams,
      transactionOutcome: error?.transactionOutcome,
      fieldErrors,
      fieldErrorCodes,
      validationIssues,
      validationIssueCodes: validationIssues.map((issue) => resolveValidationIssueCode(issue)),
      validationContext: String(error?.validationContext || "").trim(),
      pointerPrefix
    });
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
          throw createJsonApiTransportError(409, `JSON:API resource type must be ${normalizedRequestType}.`, "jsonapi_request_type_mismatch", {
            type: normalizedRequestType
          });
        }

        const nextBody = {
          ...(document.data.attributes || {})
        };

        if (allowBodyId && document.data.id != null && String(document.data.id).trim()) {
          nextBody.id = document.data.id;
        }

        Object.assign(nextBody, resolveRequestRelationships(document.data.relationships || {}, {
          payload,
          document
        }) || {});

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
    response,
    error: errorDocument
  });
}

/**
 * The route contract of one JSON:API resource route: its transport, its request
 * schemas and its success and error response schemas.
 * @param {object} options
 * @param {string} [options.type]
 * @param {string} [options.requestType]
 * @param {string} [options.responseType]
 * @param {object} [options.body] The request attributes schema.
 * @param {object} [options.query] The query schema.
 * @param {object} [options.output] The response attributes schema; required unless outputKind is no-content.
 * @param {string} [options.outputKind] record, nullable-record, collection, meta or no-content.
 * @param {number} [options.successStatus] A 2xx status.
 * @param {boolean} [options.includeValidation400]
 * @param {boolean} [options.allowSparseFields]
 * @param {boolean} [options.allowBodyId]
 * @param {string} [options.pointerPrefix]
 * @param {string[]} [options.bodyAttributeExcludeKeys]
 * @param {string[]} [options.outputAttributeExcludeKeys]
 * @param {object[]} [options.bodyRelationshipEntries]
 * @param {object[]} [options.outputRelationshipEntries]
 * @param {JsonApiRouteHook} [options.getRecordType]
 * @param {JsonApiRouteHook} [options.getRecordId]
 * @param {JsonApiRouteHook} [options.getRecordAttributes]
 * @param {JsonApiRouteHook} [options.getRecordRelationships]
 * @param {JsonApiRouteHook} [options.getRecordLinks]
 * @param {JsonApiRouteHook} [options.getRecordMeta]
 * @param {JsonApiRouteHook} [options.getIncluded]
 * @param {JsonApiRouteHook} [options.getDocumentLinks]
 * @param {JsonApiRouteHook} [options.getDocumentMeta]
 * @param {JsonApiRouteHook} [options.getCollectionItems]
 * @param {JsonApiRouteHook} [options.mapRequestRelationships]
 */
function createJsonApiResourceRouteContract({
  type = "",
  requestType = "",
  responseType = "",
  body,
  query,
  output,
  outputKind = "record",
  successStatus = 200,
  includeValidation400 = false,
  allowSparseFields = false,
  allowBodyId = false,
  pointerPrefix = "/data/attributes",
  bodyAttributeExcludeKeys = [],
  outputAttributeExcludeKeys = [],
  bodyRelationshipEntries = [],
  outputRelationshipEntries = [],
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
}) {
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
        includeLinks: Boolean(getDocumentLinks),
        includeMeta: Boolean(getDocumentMeta) || normalizedOutputKind === "collection",
        includeIncluded: Boolean(getIncluded),
        allowSparseFields,
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
  createJsonApiResourceRouteTransport,
  createJsonApiResourceRouteContract
};
