import { isRecord, normalizeArray, normalizeObject, normalizeText, normalizeTransactionOutcome } from "@jskit-ai/kernel/shared/support/normalize";
import { simplifyJsonApiResourceWithRelationshipIds } from "../support/jsonApiSimplify.js";

const JSON_API_CONTENT_TYPE = "application/vnd.api+json";

function normalizeMediaType(contentType = "") {
  return String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function isJsonContentType(contentType = "") {
  const mediaType = normalizeMediaType(contentType);
  if (!mediaType) {
    return false;
  }

  return mediaType === "application/json" || /^application\/[a-z0-9.!#$&^_-]+\+json$/i.test(mediaType);
}

function isJsonApiContentType(contentType = "") {
  return normalizeMediaType(contentType) === JSON_API_CONTENT_TYPE;
}

function resolveJsonApiTransportTypes({
  type = "",
  requestType = "",
  responseType = ""
} = {}, {
  context = "JSON:API transport"
} = {}) {
  const fallbackType = normalizeText(type);
  const normalizedRequestType = normalizeText(requestType, {
    fallback: fallbackType
  });
  const normalizedResponseType = normalizeText(responseType, {
    fallback: fallbackType || normalizedRequestType
  });

  if (!normalizedRequestType && !normalizedResponseType) {
    throw new TypeError(`${context} requires requestType, responseType, or type.`);
  }

  return Object.freeze({
    requestType: normalizedRequestType,
    responseType: normalizedResponseType
  });
}

function normalizeJsonApiResourceObject(resource = {}) {
  if (!isRecord(resource)) {
    return Object.freeze({});
  }

  const source = normalizeObject(resource);
  const normalized = {};

  if (source.type != null) {
    normalized.type = String(source.type);
  }

  if (source.id != null) {
    normalized.id = String(source.id);
  }

  if (isRecord(source.attributes)) {
    normalized.attributes = normalizeObject(source.attributes);
  }

  if (isRecord(source.relationships)) {
    normalized.relationships = normalizeObject(source.relationships);
  }

  if (isRecord(source.links)) {
    normalized.links = normalizeObject(source.links);
  }

  if (isRecord(source.meta)) {
    normalized.meta = normalizeObject(source.meta);
  }

  return Object.freeze(normalized);
}

function normalizeJsonApiResourceArray(value) {
  return Object.freeze(normalizeArray(value).map((entry) => normalizeJsonApiResourceObject(entry)));
}

function normalizeJsonApiLinks(value) {
  return isRecord(value) ? Object.freeze(normalizeObject(value)) : undefined;
}

function normalizeJsonApiMeta(value) {
  return isRecord(value) ? Object.freeze(normalizeObject(value)) : undefined;
}

function normalizeJsonApiErrors(value) {
  return Array.isArray(value)
    ? Object.freeze(value.map((entry) => (isRecord(entry) ? normalizeObject(entry) : {})))
    : undefined;
}

function isJsonApiResourceDocument(payload = {}) {
  return isRecord(payload) && isRecord(payload.data) && !Array.isArray(payload.data);
}

function isJsonApiCollectionDocument(payload = {}) {
  return isRecord(payload) && Array.isArray(payload.data);
}

function isJsonApiErrorDocument(payload = {}) {
  return isRecord(payload) && Array.isArray(payload.errors);
}

function normalizeJsonApiDocument(payload = {}) {
  const source = isRecord(payload) ? normalizeObject(payload) : {};
  const links = normalizeJsonApiLinks(source.links);
  const meta = normalizeJsonApiMeta(source.meta);
  const included = normalizeJsonApiResourceArray(source.included);

  if (isJsonApiResourceDocument(source)) {
    return Object.freeze({
      kind: "resource",
      data: normalizeJsonApiResourceObject(source.data),
      ...(included.length > 0 ? { included } : {}),
      ...(links ? { links } : {}),
      ...(meta ? { meta } : {})
    });
  }

  if (Object.hasOwn(source, "data") && source.data == null) {
    return Object.freeze({
      kind: "resource",
      data: null,
      ...(included.length > 0 ? { included } : {}),
      ...(links ? { links } : {}),
      ...(meta ? { meta } : {})
    });
  }

  if (isJsonApiCollectionDocument(source)) {
    return Object.freeze({
      kind: "collection",
      data: normalizeJsonApiResourceArray(source.data),
      ...(included.length > 0 ? { included } : {}),
      ...(links ? { links } : {}),
      ...(meta ? { meta } : {})
    });
  }

  if (isJsonApiErrorDocument(source)) {
    const errors = normalizeJsonApiErrors(source.errors);
    return Object.freeze({
      kind: "errors",
      errors: errors || Object.freeze([]),
      ...(links ? { links } : {}),
      ...(meta ? { meta } : {})
    });
  }

  if (meta && !Object.hasOwn(source, "data") && !Object.hasOwn(source, "errors")) {
    return Object.freeze({
      kind: "meta",
      meta,
      ...(links ? { links } : {})
    });
  }

  return Object.freeze({
    kind: "unknown",
    value: source
  });
}

function createJsonApiResourceObject({
  type = "",
  id = null,
  attributes = undefined,
  relationships = undefined,
  links = undefined,
  meta = undefined
} = {}) {
  const normalizedType = String(type || "").trim();
  if (!normalizedType) {
    throw new TypeError("createJsonApiResourceObject requires a non-empty type.");
  }

  const resource = {
    type: normalizedType
  };

  if (id != null && String(id).trim()) {
    resource.id = String(id);
  }

  if (attributes !== undefined) {
    if (!isRecord(attributes)) {
      throw new TypeError("createJsonApiResourceObject attributes must be an object.");
    }
    resource.attributes = normalizeObject(attributes);
  }

  if (relationships !== undefined) {
    if (!isRecord(relationships)) {
      throw new TypeError("createJsonApiResourceObject relationships must be an object.");
    }
    resource.relationships = normalizeObject(relationships);
  }

  if (links !== undefined) {
    if (!isRecord(links)) {
      throw new TypeError("createJsonApiResourceObject links must be an object.");
    }
    resource.links = normalizeObject(links);
  }

  if (meta !== undefined) {
    if (!isRecord(meta)) {
      throw new TypeError("createJsonApiResourceObject meta must be an object.");
    }
    resource.meta = normalizeObject(meta);
  }

  return Object.freeze(resource);
}

function createJsonApiDocument({
  data = undefined,
  included = undefined,
  links = undefined,
  meta = undefined,
  errors = undefined
} = {}) {
  const hasData = data !== undefined;
  const hasErrors = errors !== undefined;
  const hasMeta = meta !== undefined;

  if (!hasData && !hasErrors && !hasMeta) {
    throw new TypeError("createJsonApiDocument requires at least one of data, errors, or meta.");
  }

  if (hasData && hasErrors) {
    throw new TypeError("createJsonApiDocument cannot include both data and errors.");
  }

  const document = {};

  if (hasData) {
    if (data == null) {
      document.data = null;
    } else if (Array.isArray(data)) {
      document.data = normalizeJsonApiResourceArray(data);
    } else if (isRecord(data)) {
      document.data = normalizeJsonApiResourceObject(data);
    } else {
      throw new TypeError("createJsonApiDocument data must be a resource object, an array, or null.");
    }
  }

  if (hasErrors) {
    if (!Array.isArray(errors)) {
      throw new TypeError("createJsonApiDocument errors must be an array.");
    }

    document.errors = normalizeJsonApiErrors(errors) || Object.freeze([]);
  }

  if (included !== undefined) {
    if (!Array.isArray(included)) {
      throw new TypeError("createJsonApiDocument included must be an array.");
    }

    document.included = normalizeJsonApiResourceArray(included);
  }

  if (links !== undefined) {
    if (!isRecord(links)) {
      throw new TypeError("createJsonApiDocument links must be an object.");
    }

    document.links = Object.freeze(normalizeObject(links));
  }

  if (meta !== undefined) {
    if (!isRecord(meta)) {
      throw new TypeError("createJsonApiDocument meta must be an object.");
    }

    document.meta = Object.freeze(normalizeObject(meta));
  }

  return Object.freeze(document);
}

function createJsonApiErrorObject({
  status = "",
  code = "",
  title = "",
  detail = "",
  source = undefined,
  links = undefined,
  meta = undefined
} = {}) {
  const errorObject = {};
  const normalizedStatus = String(status || "").trim();
  const normalizedCode = String(code || "").trim();
  const normalizedTitle = String(title || "").trim();
  const normalizedDetail = String(detail || "").trim();

  if (normalizedStatus) {
    errorObject.status = normalizedStatus;
  }
  if (normalizedCode) {
    errorObject.code = normalizedCode;
  }
  if (normalizedTitle) {
    errorObject.title = normalizedTitle;
  }
  if (normalizedDetail) {
    errorObject.detail = normalizedDetail;
  }
  if (source !== undefined) {
    if (!isRecord(source)) {
      throw new TypeError("createJsonApiErrorObject source must be an object.");
    }
    errorObject.source = normalizeObject(source);
  }
  if (links !== undefined) {
    if (!isRecord(links)) {
      throw new TypeError("createJsonApiErrorObject links must be an object.");
    }
    errorObject.links = normalizeObject(links);
  }
  if (meta !== undefined) {
    if (!isRecord(meta)) {
      throw new TypeError("createJsonApiErrorObject meta must be an object.");
    }
    errorObject.meta = normalizeObject(meta);
  }

  return Object.freeze(errorObject);
}

function escapeJsonPointerSegment(value = "") {
  return String(value || "")
    .replace(/~/g, "~0")
    .replace(/\//g, "~1");
}

function resolveValidationFieldName(issue = {}) {
  const pathParts = String(issue?.instancePath || "")
    .split("/")
    .filter(Boolean);
  const missingProperty = String(issue?.params?.missingProperty || "").trim();
  const additionalProperty = String(issue?.params?.additionalProperty || "").trim();
  const leaf = additionalProperty || missingProperty || pathParts[pathParts.length - 1] || "";
  return leaf;
}

function resolveJsonApiValidationSource(issue = {}, validationContext = "") {
  const normalizedContext = String(validationContext || "").trim().toLowerCase();
  const fieldName = resolveValidationFieldName(issue);
  if (normalizedContext === "querystring" || normalizedContext === "params") {
    return fieldName ? Object.freeze({ parameter: fieldName }) : undefined;
  }

  const instancePath = String(issue?.instancePath || "").trim();
  if (!instancePath && !fieldName) {
    return undefined;
  }

  const pointerBase = instancePath || "";
  const pointer =
    fieldName && !pointerBase.endsWith(`/${fieldName}`)
      ? `${pointerBase}/${escapeJsonPointerSegment(fieldName)}`
      : pointerBase;
  return Object.freeze({
    pointer: pointer || "/"
  });
}

const INVALID_VALUE_CODE = Object.freeze({ code: "kernel.validation.invalid", params: {} });

function normalizeCodedEntry(entry) {
  return isRecord(entry) && normalizeText(entry.code)
    ? { code: normalizeText(entry.code), params: isRecord(entry.params) ? entry.params : {} }
    : null;
}

// Each entry's meta carries what a client needs to show it in the user's language:
// params and messageCode for the code and title, fieldErrorCode for the detail.
function createJsonApiErrorMeta({ transactionOutcome, params, messageCode, messageParams, fieldErrorCode }) {
  const meta = {};
  if (transactionOutcome) {
    meta.transactionOutcome = transactionOutcome;
  }
  if (isRecord(params) && Object.keys(params).length > 0) {
    meta.params = params;
  }
  if (normalizeText(messageCode)) {
    meta.messageCode = normalizeText(messageCode);
    meta.messageParams = isRecord(messageParams) ? messageParams : {};
  }
  if (fieldErrorCode) {
    meta.fieldErrorCode = fieldErrorCode;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function createJsonApiErrorDocumentFromFailure({
  statusCode = 500,
  code = "",
  message = "",
  params = {},
  messageCode = "",
  messageParams = {},
  transactionOutcome,
  fieldErrors = {},
  fieldErrorCodes = {},
  validationIssues = [],
  validationIssueCodes = [],
  validationContext = "",
  pointerPrefix = "/data/attributes"
} = {}) {
  const errorMeta = {
    transactionOutcome: normalizeTransactionOutcome(transactionOutcome),
    params,
    messageCode,
    messageParams
  };
  const normalizedStatus = String(Number(statusCode) || 500);
  const normalizedCode = String(code || "").trim();
  const normalizedMessage = String(message || "").trim() || "Request failed.";
  const normalizedFieldErrors = isRecord(fieldErrors) ? normalizeObject(fieldErrors) : {};
  const normalizedFieldErrorCodes = isRecord(fieldErrorCodes) ? fieldErrorCodes : {};
  const issues = Array.isArray(validationIssues) ? validationIssues : [];
  const issueCodes = Array.isArray(validationIssueCodes) ? validationIssueCodes : [];

  if (issues.length > 0) {
    return createJsonApiDocument({
      errors: issues.map((issue, index) => {
        const detail = String(issue?.message || "").trim();
        return createJsonApiErrorObject({
          status: normalizedStatus,
          meta: createJsonApiErrorMeta({
            ...errorMeta,
            fieldErrorCode: detail ? normalizeCodedEntry(issueCodes[index]) : INVALID_VALUE_CODE
          }),
          code: normalizedCode,
          title: normalizedMessage,
          detail: detail || "Invalid value.",
          source: resolveJsonApiValidationSource(issue, validationContext)
        });
      })
    });
  }

  const fieldEntries = Object.entries(normalizedFieldErrors).filter(([field]) => String(field || "").trim());
  if (fieldEntries.length > 0) {
    return createJsonApiDocument({
      errors: fieldEntries.map(([field, fieldDetail]) => {
        const detail = String(fieldDetail || "").trim();
        return createJsonApiErrorObject({
          status: normalizedStatus,
          meta: createJsonApiErrorMeta({
            ...errorMeta,
            fieldErrorCode: detail ? normalizeCodedEntry(normalizedFieldErrorCodes[field]) : INVALID_VALUE_CODE
          }),
          code: normalizedCode,
          title: normalizedMessage,
          detail: detail || "Invalid value.",
          source: {
            pointer: `${pointerPrefix}/${escapeJsonPointerSegment(field)}`
          }
        });
      })
    });
  }

  return createJsonApiDocument({
    errors: [
      createJsonApiErrorObject({
        status: normalizedStatus,
        meta: createJsonApiErrorMeta(errorMeta),
        code: normalizedCode,
        title: normalizedMessage
      })
    ]
  });
}

function simplifyJsonApiResourceObject(resource = {}) {
  return simplifyJsonApiResourceWithRelationshipIds(normalizeJsonApiResourceObject(resource));
}

function simplifyJsonApiDocument(payload = {}) {
  const document = normalizeJsonApiDocument(payload);

  if (document.kind === "resource") {
    return document.data == null ? null : simplifyJsonApiResourceObject(document.data);
  }

  if (document.kind === "collection") {
    return document.data.map((entry) => simplifyJsonApiResourceObject(entry));
  }

  if (document.kind === "meta") {
    return document.meta || {};
  }

  return payload;
}

export {
  JSON_API_CONTENT_TYPE,
  resolveJsonApiTransportTypes,
  createJsonApiDocument,
  createJsonApiErrorDocumentFromFailure,
  createJsonApiErrorObject,
  createJsonApiResourceObject,
  isJsonApiCollectionDocument,
  isJsonApiContentType,
  isJsonApiErrorDocument,
  isJsonApiResourceDocument,
  isJsonContentType,
  normalizeCodedEntry,
  normalizeJsonApiDocument,
  normalizeJsonApiResourceObject,
  simplifyJsonApiDocument
};
