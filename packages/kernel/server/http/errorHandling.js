import { ActionRuntimeError } from "../actions/actionDefinitions.js";
import { isRecord, normalizeTransactionOutcome } from "../../shared/support/normalize.js";
import { JSON_API_CONTENT_TYPE } from "./lib/routeTransport.js";

const JSON_API_CONTENT_TYPE_PARSER_MARKER = Symbol.for("jskit.fastify.jsonApiContentTypeParserRegistered");
const BODYLESS_CONTENT_TYPE_NORMALIZER_MARKER = Symbol.for("jskit.fastify.bodylessContentTypeNormalizerRegistered");

function registerJsonApiContentTypeParser(fastify) {
  if (!fastify || typeof fastify.addContentTypeParser !== "function") {
    throw new TypeError("registerJsonApiContentTypeParser requires a Fastify instance.");
  }

  if (fastify[JSON_API_CONTENT_TYPE_PARSER_MARKER]) {
    return false;
  }

  if (typeof fastify.hasContentTypeParser === "function" && fastify.hasContentTypeParser(JSON_API_CONTENT_TYPE)) {
    fastify[JSON_API_CONTENT_TYPE_PARSER_MARKER] = true;
    return false;
  }

  fastify.addContentTypeParser(
    JSON_API_CONTENT_TYPE,
    { parseAs: "string" },
    fastify.getDefaultJsonParser("ignore", "ignore")
  );
  fastify[JSON_API_CONTENT_TYPE_PARSER_MARKER] = true;
  return true;
}

function hasHeaderValue(headers = {}, key = "") {
  return String(headers?.[key] ?? "").trim().length > 0;
}

function hasRequestBody(headers = {}) {
  const transferEncoding = String(headers?.["transfer-encoding"] ?? "").trim();
  if (transferEncoding) {
    return true;
  }

  const contentLengthHeader = String(headers?.["content-length"] ?? "").trim();
  if (!contentLengthHeader) {
    return false;
  }

  const contentLength = Number(contentLengthHeader);
  if (!Number.isFinite(contentLength)) {
    return true;
  }

  return contentLength > 0;
}

function normalizeBodylessContentTypeHeader(request = null) {
  const headers = request?.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return false;
  }

  if (!hasHeaderValue(headers, "content-type")) {
    return false;
  }

  if (hasRequestBody(headers)) {
    return false;
  }

  delete headers["content-type"];
  return true;
}

function registerBodylessContentTypeNormalizer(fastify) {
  if (!fastify || typeof fastify.addHook !== "function") {
    throw new TypeError("registerBodylessContentTypeNormalizer requires a Fastify instance.");
  }

  if (fastify[BODYLESS_CONTENT_TYPE_NORMALIZER_MARKER]) {
    return false;
  }

  fastify.addHook("onRequest", async (request) => {
    normalizeBodylessContentTypeHeader(request);
  });
  fastify[BODYLESS_CONTENT_TYPE_NORMALIZER_MARKER] = true;
  return true;
}

function resolveValidationFieldErrors(error) {
  const issues = Array.isArray(error?.validation) ? error.validation : [];
  const fieldErrors = {};

  for (const issue of issues) {
    const fieldFromPath = String(issue.instancePath || "")
      .replace(/^\//, "")
      .replace(/\//g, ".");
    const field =
      fieldFromPath || String(issue.params?.missingProperty || issue.params?.additionalProperty || "request").trim();

    if (!fieldErrors[field]) {
      fieldErrors[field] = issue.message || "Invalid value.";
    }
  }

  return fieldErrors;
}

function resolveRequestRouteTransport(request) {
  const transport = request?.routeOptions?.config?.transport;
  return isRecord(transport) ? transport : null;
}

function applyRouteTransportErrorResponse(reply, request, error, {
  statusCode = 500,
  normalizedErrorCode = "",
  message = error?.message,
  exposeDetails = true
} = {}) {
  const transport = resolveRequestRouteTransport(request);
  const errorSerializer = transport && typeof transport.error === "function" ? transport.error : null;
  if (!errorSerializer) {
    return false;
  }

  const payload = errorSerializer(error, {
    request,
    reply,
    statusCode,
    code: normalizedErrorCode,
    message,
    exposeDetails
  });

  if (payload && typeof payload.then === "function") {
    throw new TypeError("Route transport error serializer must return synchronously.");
  }

  if (transport.contentType) {
    reply.header("Content-Type", transport.contentType);
  }

  reply.code(statusCode).send(payload);
  return true;
}

function resolveApiErrorStatus(error, code) {
  // JSON REST's public error codes need HTTP classification even without status hints.
  switch (code) {
    case "REST_API_VALIDATION":
      return 422;
    case "REST_API_RESOURCE":
      switch (error?.subtype) {
        case "not_found": return 404;
        case "forbidden": return 403;
        case "conflict": return 409;
        default: return 400;
      }
    case "REST_API_VERSION_CONFLICT":
      return 409;
    case "REST_API_PRECONDITION_FAILED":
      return 412;
    case "REST_API_FIELDSET_INVALID":
    case "REST_API_INCLUDE_INVALID":
      return 400;
    case "REST_API_PAYLOAD":
      return error?.statusCode === 413 ? 413 : 400;
    case "REST_API_TEMPORAL_DATA_INVALID":
      return 500;
    default: {
      const status = Number(error?.statusCode || error?.status);
      return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
    }
  }
}

function applyErrorHeaders(reply, error) {
  if (error?.headers && typeof error.headers === "object") {
    for (const [name, value] of Object.entries(error.headers)) {
      reply.header(name, value);
    }
  }
}

function registerApiErrorHandler(app, { isAppError } = {}) {
  if (!app || typeof app.setErrorHandler !== "function") {
    throw new TypeError("registerApiErrorHandler requires a Fastify instance.");
  }
  if (typeof isAppError !== "function") {
    throw new TypeError("registerApiErrorHandler requires isAppError.");
  }

  function shouldExposeAppErrorDetails(errorCode = "") {
    return String(errorCode || "").trim() !== "ACTION_PERMISSION_DENIED";
  }

  app.setErrorHandler((error, request, reply) => {
    const normalizedErrorCode = String(error?.code || "").trim();
    const transactionOutcome = normalizeTransactionOutcome(error?.transactionOutcome);
    const outcomeFields = transactionOutcome ? { transactionOutcome } : {};
    const isCsrfErrorCode = normalizedErrorCode.startsWith("FST_CSRF_");
    const statusCode = resolveApiErrorStatus(error, normalizedErrorCode);

    if (Array.isArray(error?.validation)) {
      const fieldErrors = resolveValidationFieldErrors(error);
      const validationErrorCode = normalizedErrorCode || "validation_failed";
      if (applyRouteTransportErrorResponse(reply, request, error, {
        statusCode: 400,
        normalizedErrorCode: validationErrorCode
      })) {
        return;
      }
      reply.code(400).send({
        error: "Validation failed.",
        code: validationErrorCode,
        ...outcomeFields,
        fieldErrors,
        details: {
          fieldErrors
        }
      });
      return;
    }

    applyErrorHeaders(reply, error);

    if (isAppError(error) || error instanceof ActionRuntimeError) {
      if (error.status >= 500) {
        app.log.error({ err: error }, "AppError 5xx");
      }
      const appErrorCode = normalizedErrorCode || "app_error";
      const exposeDetails = shouldExposeAppErrorDetails(appErrorCode);
      if (applyRouteTransportErrorResponse(reply, request, error, {
        statusCode: error.status,
        normalizedErrorCode: appErrorCode,
        exposeDetails
      })) {
        return;
      }

      const payload = {
        error: error.message,
        code: appErrorCode,
        ...outcomeFields
      };
      if (error.details && exposeDetails) {
        payload.details = error.details;
        if (error.details.fieldErrors) {
          payload.fieldErrors = error.details.fieldErrors;
        }
      }

      reply.code(error.status).send(payload);
      return;
    }

    if (statusCode >= 500) {
      app.log.error({ err: error }, "Unhandled error");
    } else {
      app.log.info({ err: error, statusCode }, "Request rejected");
    }

    const message = statusCode >= 500 ? "Internal server error." : String(error?.message || "Request failed.");
    const fallbackErrorCode =
      normalizedErrorCode || (statusCode >= 500 ? "internal_server_error" : "request_failed");
    if (applyRouteTransportErrorResponse(reply, request, error, {
      statusCode,
      normalizedErrorCode: fallbackErrorCode,
      message,
      exposeDetails: statusCode < 500
    })) {
      return;
    }
    const payload = {
      error: message,
      code: fallbackErrorCode,
      ...outcomeFields
    };
    if (isCsrfErrorCode) {
      payload.details = {
        code: normalizedErrorCode
      };
    }
    reply.code(statusCode).send(payload);
  });
}

export {
  registerJsonApiContentTypeParser,
  normalizeBodylessContentTypeHeader,
  registerBodylessContentTypeNormalizer,
  registerApiErrorHandler
};
