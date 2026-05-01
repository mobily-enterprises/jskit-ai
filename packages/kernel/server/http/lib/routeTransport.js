import { normalizeObject, normalizeText } from "../../../shared/support/normalize.js";

const ROUTE_TRANSPORT_KINDS = Object.freeze([
  "command",
  "jsonapi-resource"
]);

function normalizeRouteOutputTransform(value, { context = "route output", ErrorType = Error } = {}) {
  if (value == null) {
    return null;
  }

  if (typeof value !== "function") {
    throw new ErrorType(`${context} must be a function.`);
  }

  return value;
}

function normalizeRouteTransport(value, { context = "route transport", ErrorType = Error } = {}) {
  if (value == null) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ErrorType(`${context} must be an object.`);
  }

  const source = normalizeObject(value);
  const unsupportedKeys = Object.keys(source).filter(
    (key) => !["kind", "request", "response", "error", "contentType"].includes(key)
  );
  if (unsupportedKeys.length > 0) {
    throw new ErrorType(`${context}.${unsupportedKeys[0]} is not supported.`);
  }

  const normalized = {};

  if (Object.hasOwn(source, "kind")) {
    const kind = normalizeText(source.kind).toLowerCase();
    if (!kind) {
      throw new ErrorType(`${context}.kind must be a non-empty string.`);
    }
    if (!ROUTE_TRANSPORT_KINDS.includes(kind)) {
      throw new ErrorType(
        `${context}.kind must be one of: ${ROUTE_TRANSPORT_KINDS.join(", ")}.`
      );
    }
    normalized.kind = kind;
  }

  if (Object.hasOwn(source, "request")) {
    const request = source.request;
    if (request != null) {
      if (!request || typeof request !== "object" || Array.isArray(request)) {
        throw new ErrorType(`${context}.request must be an object.`);
      }

      const requestSource = normalizeObject(request);
      const unsupportedRequestKeys = Object.keys(requestSource).filter(
        (key) => !["body", "query", "params"].includes(key)
      );
      if (unsupportedRequestKeys.length > 0) {
        throw new ErrorType(`${context}.request.${unsupportedRequestKeys[0]} is not supported.`);
      }

      const normalizedRequest = {};
      for (const key of ["body", "query", "params"]) {
        if (!Object.hasOwn(requestSource, key)) {
          continue;
        }

        const transform = requestSource[key];
        if (transform == null) {
          continue;
        }

        if (typeof transform !== "function") {
          throw new ErrorType(`${context}.request.${key} must be a function.`);
        }

        normalizedRequest[key] = transform;
      }

      if (Object.keys(normalizedRequest).length > 0) {
        normalized.request = Object.freeze(normalizedRequest);
      }
    }
  }

  if (Object.hasOwn(source, "response")) {
    const responseTransform = source.response;
    if (responseTransform != null && typeof responseTransform !== "function") {
      throw new ErrorType(`${context}.response must be a function.`);
    }
    if (responseTransform) {
      normalized.response = responseTransform;
    }
  }

  if (Object.hasOwn(source, "error")) {
    const errorTransform = source.error;
    if (errorTransform != null && typeof errorTransform !== "function") {
      throw new ErrorType(`${context}.error must be a function.`);
    }
    if (errorTransform) {
      normalized.error = errorTransform;
    }
  }

  if (Object.hasOwn(source, "contentType")) {
    const contentType = normalizeText(source.contentType);
    if (!contentType) {
      throw new ErrorType(`${context}.contentType must be a non-empty string.`);
    }
    normalized.contentType = contentType;
  }

  return Object.freeze(normalized);
}

export {
  ROUTE_TRANSPORT_KINDS,
  normalizeRouteOutputTransform,
  normalizeRouteTransport
};
