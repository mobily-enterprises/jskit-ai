import { normalizeArray, normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  JSON_API_CONTENT_TYPE,
  createJsonApiDocument,
  createJsonApiResourceObject,
  normalizeJsonApiDocument,
  resolveJsonApiTransportTypes
} from "../validators/jsonApiTransport.js";
import { encodeJsonApiResourceQueryObject } from "../validators/jsonApiQueryTransport.js";
import {
  resolveRelationshipFieldKey,
  simplifyJsonApiResourceWithRelationshipIds
} from "../support/jsonApiSimplify.js";

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
    includeBodyId: transport?.includeBodyId === true,
    lookupContainerKey: normalizeText(transport?.lookupContainerKey, {
      fallback: "lookups"
    }),
    lookupFieldMap: Object.freeze(
      Object.fromEntries(
        Object.entries(normalizeObject(transport?.lookupFieldMap))
          .map(([relationshipName, fieldKey]) => [
            normalizeText(relationshipName),
            normalizeText(fieldKey)
          ])
          .filter(([relationshipName, fieldKey]) => relationshipName && fieldKey)
          .sort(([left], [right]) => left.localeCompare(right))
      )
    )
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

function createIncludedResourceIndex(document = {}) {
  const index = new Map();

  for (const resource of normalizeArray(document?.included)) {
    const type = normalizeText(resource?.type);
    const id = normalizeText(resource?.id);
    if (!type || !id) {
      continue;
    }

    index.set(`${type}:${id}`, resource);
  }

  return index;
}

function simplifyRelationshipResource(linkage = {}, options = {}) {
  const normalizedLinkage = isRecord(linkage) ? normalizeObject(linkage) : {};
  const type = normalizeText(normalizedLinkage.type);
  const id = normalizeText(normalizedLinkage.id);
  if (!type || !id) {
    return null;
  }

  const resourceKey = `${type}:${id}`;
  const includedResource = options.includedResourceIndex?.get(resourceKey);
  if (!includedResource) {
    return null;
  }

  return simplifyResourceObject(includedResource, options);
}

function simplifyResourceObject(resource = {}, options = {}) {
  const normalizedResource = isRecord(resource) ? normalizeObject(resource) : {};
  const simplified = simplifyJsonApiResourceWithRelationshipIds(normalizedResource, {
    lookupFieldMap: options.lookupFieldMap || null
  });
  const lookupContainerKey = normalizeText(options.lookupContainerKey, {
    fallback: "lookups"
  });
  const lookupFieldMap = options.lookupFieldMap || null;
  const resourceKey = `${normalizeText(normalizedResource.type)}:${normalizeText(normalizedResource.id)}`;
  if (resourceKey && options.inFlightKeys?.has(resourceKey)) {
    return simplified;
  }
  if (resourceKey && options.resourceCache?.has(resourceKey)) {
    return options.resourceCache.get(resourceKey);
  }

  if (resourceKey) {
    options.inFlightKeys?.add(resourceKey);
  }

  const lookups = {};
  for (const [relationshipName, relationshipValue] of Object.entries(normalizeObject(normalizedResource.relationships))) {
    const relationshipData = relationshipValue?.data;
    if (Array.isArray(relationshipData)) {
      const items = relationshipData
        .map((entry) =>
          simplifyRelationshipResource(entry, {
            ...options,
            lookupFieldMap: null
          })
        )
        .filter(Boolean);
      if (items.length > 0) {
        lookups[relationshipName] = items;
      }
      continue;
    }

    const fieldKey = resolveRelationshipFieldKey(relationshipName, lookupFieldMap);
    if (!Object.hasOwn(simplified, fieldKey)) {
      simplified[fieldKey] = relationshipData?.id == null ? null : String(relationshipData.id);
    }

    const lookupRecord = relationshipData == null
      ? null
      : simplifyRelationshipResource(relationshipData, {
          ...options,
          lookupFieldMap: null
        });
    if (lookupRecord) {
      lookups[fieldKey] = lookupRecord;
      if (relationshipName !== fieldKey) {
        lookups[relationshipName] = lookupRecord;
      }
    }
  }

  if (Object.keys(lookups).length > 0) {
    simplified[lookupContainerKey] = lookups;
  }
  if (resourceKey) {
    options.inFlightKeys?.delete(resourceKey);
    options.resourceCache?.set(resourceKey, simplified);
  }

  return simplified;
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
  const simplifyOptions = {
    lookupContainerKey: normalizedTransport.lookupContainerKey,
    lookupFieldMap: normalizedTransport.lookupFieldMap,
    includedResourceIndex: createIncludedResourceIndex(document),
    resourceCache: new Map(),
    inFlightKeys: new Set()
  };
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
      items: document.data.map((entry) => simplifyResourceObject(entry, simplifyOptions)),
      ...resolveCollectionPageMeta(document)
    };
  }

  if (normalizedTransport.responseKind === "meta") {
    if (document.kind !== "meta") {
      throw new Error("Expected JSON:API meta document.");
    }

    return isRecord(document.meta) ? document.meta : {};
  }

  if (normalizedTransport.responseKind === "nullable-record") {
    if (document.kind !== "resource") {
      throw new Error("Expected JSON:API resource document.");
    }

    if (document.data != null) {
      assertPrimaryDataType(document.data, normalizedTransport.responseType);
    }

    return document.data == null ? null : simplifyResourceObject(document.data, simplifyOptions);
  }

  if (document.kind !== "resource") {
    throw new Error("Expected JSON:API resource document.");
  }

  if (document.data != null) {
    assertPrimaryDataType(document.data, normalizedTransport.responseType);
  }

  return document.data == null ? null : simplifyResourceObject(document.data, simplifyOptions);
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
