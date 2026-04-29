import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonApiResourceDocument(payload = {}) {
  return isRecord(payload) && isRecord(payload.data) && !Array.isArray(payload.data);
}

function isJsonApiCollectionDocument(payload = {}) {
  return isRecord(payload) && Array.isArray(payload.data);
}

function simplifyJsonApiDocument(payload = {}) {
  if (isJsonApiResourceDocument(payload)) {
    const resource = normalizeObject(payload.data);
    return {
      id: resource.id == null ? "" : String(resource.id),
      ...normalizeObject(resource.attributes)
    };
  }

  if (isJsonApiCollectionDocument(payload)) {
    return payload.data.map((entry) => simplifyJsonApiDocument({ data: entry }));
  }

  if (isRecord(payload) && isRecord(payload.meta) && !Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.meta;
  }

  return payload;
}

export {
  simplifyJsonApiDocument
};
