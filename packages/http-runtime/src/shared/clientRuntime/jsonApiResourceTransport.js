import { normalizeArray, normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  JSON_API_CONTENT_TYPE,
  createJsonApiDocument,
  createJsonApiResourceObject,
  normalizeJsonApiDocument,
  resolveJsonApiTransportTypes
} from "../validators/jsonApiTransport.js";
import { encodeJsonApiResourceQueryObject } from "../validators/jsonApiQueryTransport.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTransportKind(transport = null) {
  return String(transport?.kind || "").trim().toLowerCase();
}

function isJsonApiResourceTransport(transport = null) {
  return normalizeTransportKind(transport) === "jsonapi-resource";
}

function normalizeJsonApiClientTransport(transport = null) {
  if (!isJsonApiResourceTransport(transport)) {
    return null;
  }

  const resolvedTypes = resolveJsonApiTransportTypes(transport, {
    context: "JSON:API client transport"
  });

  return Object.freeze({
    kind: "jsonapi-resource",
    requestType: resolvedTypes.requestType,
    responseType: resolvedTypes.responseType,
    responseKind: normalizeText(transport?.responseKind, {
      fallback: "record"
    }).toLowerCase(),
    includeBodyId: transport?.includeBodyId === true
  });
}

function defaultEncodeAttributes(body = {}) {
  const source = normalizeObject(body);
  const attributes = {
    ...source
  };
  delete attributes.id;
  return attributes;
}

function encodeJsonApiResourceRequestBody(body, transport = null) {
  const normalizedTransport = normalizeJsonApiClientTransport(transport);
  if (!normalizedTransport) {
    return body;
  }

  if (!isRecord(body)) {
    throw new TypeError("JSON:API resource request body must be an object.");
  }

  if (!normalizedTransport.requestType) {
    throw new TypeError("JSON:API resource request body requires requestType.");
  }

  const source = normalizeObject(body);
  return createJsonApiDocument({
    data: createJsonApiResourceObject({
      type: normalizedTransport.requestType,
      ...(normalizedTransport.includeBodyId && source.id != null ? { id: source.id } : {}),
      attributes: defaultEncodeAttributes(source)
    })
  });
}

function encodeJsonApiResourceQuery(query, transport = null) {
  const normalizedTransport = normalizeJsonApiClientTransport(transport);
  if (!normalizedTransport) {
    return query;
  }

  return encodeJsonApiResourceQueryObject(query, {
    responseType: normalizedTransport.responseType
  });
}

function simplifyResourceObject(resource = {}) {
  const normalizedResource = isRecord(resource) ? normalizeObject(resource) : {};
  return {
    id: normalizedResource.id == null ? "" : String(normalizedResource.id),
    ...(normalizeObject(normalizedResource.attributes))
  };
}

function assertPrimaryDataType(resource = {}, expectedType = "") {
  const normalizedExpectedType = normalizeText(expectedType);
  if (!normalizedExpectedType) {
    return;
  }

  const actualType = normalizeText(resource?.type);
  if (actualType && actualType !== normalizedExpectedType) {
    throw new Error(`Expected JSON:API resource type ${normalizedExpectedType}, received ${actualType}.`);
  }
}

function resolveCollectionPageMeta(document = {}) {
  const nextCursor = normalizeText(
    document?.meta?.page?.nextCursor || document?.meta?.pagination?.cursor?.next
  );
  return {
    nextCursor: nextCursor || null,
    ...(isRecord(document?.meta) ? { meta: document.meta } : {}),
    ...(isRecord(document?.links) ? { links: document.links } : {})
  };
}

function decodeJsonApiResourceResponse(payload, transport = null) {
  const normalizedTransport = normalizeJsonApiClientTransport(transport);
  if (!normalizedTransport) {
    return payload;
  }

  const document = normalizeJsonApiDocument(payload);
  if (document.kind === "unknown") {
    throw new Error("Expected JSON:API response document.");
  }

  if (normalizedTransport.responseKind === "collection") {
    if (document.kind !== "collection") {
      throw new Error("Expected JSON:API collection document.");
    }

    for (const entry of document.data) {
      assertPrimaryDataType(entry, normalizedTransport.responseType);
    }

    return {
      items: document.data.map((entry) => simplifyResourceObject(entry)),
      ...resolveCollectionPageMeta(document)
    };
  }

  if (normalizedTransport.responseKind === "nullable-record") {
    if (document.kind !== "resource") {
      throw new Error("Expected JSON:API resource document.");
    }

    if (document.data != null) {
      assertPrimaryDataType(document.data, normalizedTransport.responseType);
    }

    return document.data == null ? null : simplifyResourceObject(document.data);
  }

  if (document.kind !== "resource") {
    throw new Error("Expected JSON:API resource document.");
  }

  if (document.data != null) {
    assertPrimaryDataType(document.data, normalizedTransport.responseType);
  }

  return document.data == null ? null : simplifyResourceObject(document.data);
}

function decodeJsonApiErrorFieldErrors(payload = {}) {
  const document = normalizeJsonApiDocument(payload);
  if (document.kind !== "errors") {
    return {};
  }

  const fieldErrors = {};
  for (const error of normalizeArray(document.errors)) {
    const pointer = normalizeText(error?.source?.pointer);
    const parameter = normalizeText(error?.source?.parameter);
    const detail = normalizeText(error?.detail || error?.title, {
      fallback: "Invalid value."
    });

    if (parameter && !Object.hasOwn(fieldErrors, parameter)) {
      fieldErrors[parameter] = detail;
      continue;
    }

    if (!pointer.startsWith("/data/attributes/")) {
      continue;
    }

    const fieldName = normalizeText(pointer.slice("/data/attributes/".length).split("/")[0]);
    if (fieldName && !Object.hasOwn(fieldErrors, fieldName)) {
      fieldErrors[fieldName] = detail;
    }
  }

  return fieldErrors;
}

function createJsonApiClientErrorPayload(payload = {}) {
  const document = normalizeJsonApiDocument(payload);
  if (document.kind !== "errors") {
    return null;
  }

  const firstError = normalizeArray(document.errors)[0] || {};
  const fieldErrors = decodeJsonApiErrorFieldErrors(payload);

  return {
    error: normalizeText(firstError.detail || firstError.title, {
      fallback: "Request failed."
    }),
    code: normalizeText(firstError.code) || null,
    ...(Object.keys(fieldErrors).length > 0
      ? {
          fieldErrors,
          details: {
            fieldErrors
          }
        }
      : {})
  };
}

export {
  JSON_API_CONTENT_TYPE,
  isJsonApiResourceTransport,
  normalizeJsonApiClientTransport,
  encodeJsonApiResourceRequestBody,
  encodeJsonApiResourceQuery,
  decodeJsonApiResourceResponse,
  decodeJsonApiErrorFieldErrors,
  createJsonApiClientErrorPayload
};
