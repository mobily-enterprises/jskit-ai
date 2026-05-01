import { ActionRuntimeError } from "../../shared/actions/actionDefinitions.js";
import { normalizeOpaqueId } from "../../shared/support/normalize.js";
import { isAppError } from "./errors.js";
import { resolveDefaultSurfaceId } from "../support/appConfig.js";

const JSON_API_CONTENT_TYPE = "application/vnd.api+json";
const JSON_API_CONTENT_TYPE_PARSER_MARKER = Symbol.for("jskit.fastify.jsonApiContentTypeParserRegistered");

function resolveLoggerLevel({ configuredLevel = "", nodeEnv = "development", allowedLevels = [] } = {}) {
  const normalizedConfiguredLevel = String(configuredLevel || "")
    .trim()
    .toLowerCase();
  const allowedLevelSet =
    allowedLevels instanceof Set
      ? new Set(allowedLevels)
      : new Set(Array.isArray(allowedLevels) ? allowedLevels : []);
  if (allowedLevelSet.has(normalizedConfiguredLevel)) {
    return normalizedConfiguredLevel;
  }

  return String(nodeEnv || "").trim().toLowerCase() === "production" ? "info" : "debug";
}

function createFastifyLoggerOptions({
  configuredLevel = "",
  nodeEnv = "development",
  allowedLevels = [],
  redactPaths = [],
  redactCensor = "[REDACTED]"
} = {}) {
  return {
    level: resolveLoggerLevel({
      configuredLevel,
      nodeEnv,
      allowedLevels
    }),
    redact: {
      paths: Array.isArray(redactPaths) ? redactPaths : [],
      censor: redactCensor
    }
  };
}

function createFallbackJsonBodyParser() {
  return function parseJsonBody(_request, body, done) {
    const source = typeof body === "string" ? body.trim() : "";
    if (!source) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(source));
    } catch (error) {
      if (error && typeof error === "object" && !Array.isArray(error)) {
        error.statusCode = 400;
      }
      done(error);
    }
  };
}

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

  const parser = typeof fastify.getDefaultJsonParser === "function"
    ? fastify.getDefaultJsonParser("ignore", "ignore")
    : createFallbackJsonBodyParser();

  fastify.addContentTypeParser(JSON_API_CONTENT_TYPE, { parseAs: "string" }, parser);
  fastify[JSON_API_CONTENT_TYPE_PARSER_MARKER] = true;
  return true;
}

function registerRequestLoggingHooks(
  app,
  {
    requestStartedAtSymbol,
    getPathname,
    getSurface,
    observeRequest,
    enableRequestLogs = true,
    defaultSurfaceId = ""
  } = {}
) {
  if (!app || typeof app.addHook !== "function") {
    throw new TypeError("registerRequestLoggingHooks requires a Fastify instance.");
  }

  const startedAtSymbol = requestStartedAtSymbol || Symbol("request_started_at_ns");
  const resolvePathname = typeof getPathname === "function" ? getPathname : () => "/";
  const resolveSurface =
    typeof getSurface === "function"
      ? getSurface
      : () =>
          resolveDefaultSurfaceId(null, {
            defaultSurfaceId
          });

  app.addHook("onRequest", async (request) => {
    request[startedAtSymbol] = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = request[startedAtSymbol];
    const durationMs =
      typeof startedAt === "bigint" ? Number(process.hrtime.bigint() - startedAt) / 1_000_000 : Number.NaN;
    const pathnameValue = resolvePathname(request);
    const routeUrl = String(request?.routeOptions?.url || "").trim();
    const surface = resolveSurface(pathnameValue, request);
    const actorId = normalizeOpaqueId(request?.user?.id);
    const logPayload = {
      requestId: String(request?.id || ""),
      method: String(request?.method || ""),
      path: pathnameValue,
      routeUrl,
      surface,
      statusCode: Number(reply?.statusCode || 0),
      durationMs: Number.isFinite(durationMs) ? Number(durationMs.toFixed(3)) : null
    };

    if (actorId != null) {
      logPayload.actorId = actorId;
    }

    if (typeof observeRequest === "function") {
      observeRequest({
        method: logPayload.method,
        route: routeUrl || pathnameValue,
        surface,
        statusCode: logPayload.statusCode,
        durationMs
      });
    }

    if (enableRequestLogs) {
      request.log.info(logPayload, "request.completed");
    }
  });
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
  const directTransport =
    request?.routeTransport && typeof request.routeTransport === "object" && !Array.isArray(request.routeTransport)
      ? request.routeTransport
      : null;
  if (directTransport) {
    return directTransport;
  }

  const configTransport =
    request?.routeOptions?.config?.transport &&
    typeof request.routeOptions.config.transport === "object" &&
    !Array.isArray(request.routeOptions.config.transport)
      ? request.routeOptions.config.transport
      : null;
  const runtimeTransport =
    configTransport?.runtime && typeof configTransport.runtime === "object" && !Array.isArray(configTransport.runtime)
      ? configTransport.runtime
      : null;
  if (runtimeTransport) {
    return runtimeTransport;
  }

  return configTransport;
}

function applyRouteTransportErrorResponse(reply, request, error, {
  statusCode = 500,
  normalizedErrorCode = ""
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
    code: normalizedErrorCode
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

function registerApiErrorHandler(
  app,
  {
    isAppError,
    onRecordDbError,
    onCaptureServerError,
    appErrorLogMessage = "AppError 5xx",
    unhandledErrorLogMessage = "Unhandled error"
  } = {}
) {
  if (!app || typeof app.setErrorHandler !== "function") {
    throw new TypeError("registerApiErrorHandler requires a Fastify instance.");
  }
  if (typeof isAppError !== "function") {
    throw new TypeError("registerApiErrorHandler requires isAppError.");
  }

  const recordDbError = typeof onRecordDbError === "function" ? onRecordDbError : () => {};
  const captureServerError = typeof onCaptureServerError === "function" ? onCaptureServerError : () => {};

  function shouldExposeAppErrorDetails(errorCode = "") {
    return String(errorCode || "").trim() !== "ACTION_PERMISSION_DENIED";
  }

  app.setErrorHandler((error, request, reply) => {
    const normalizedErrorCode = String(error?.code || "").trim();
    const isCsrfErrorCode = normalizedErrorCode.startsWith("FST_CSRF_");
    const statusFromError = Number(error?.statusCode || error?.status);
    const statusCode =
      Number.isInteger(statusFromError) && statusFromError >= 400 && statusFromError <= 599 ? statusFromError : 500;

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
        fieldErrors,
        details: {
          fieldErrors
        }
      });
      return;
    }

    if (isAppError(error) || error instanceof ActionRuntimeError) {
      if (applyRouteTransportErrorResponse(reply, request, error, {
        statusCode: error.status,
        normalizedErrorCode: normalizedErrorCode || "app_error"
      })) {
        return;
      }
      if (error.status >= 500) {
        recordDbError(error);
        captureServerError(request, error, error.status);
        app.log.error({ err: error }, appErrorLogMessage);
      }

      const appErrorCode = normalizedErrorCode || "app_error";
      const payload = {
        error: error.message,
        code: appErrorCode
      };
      if (error.details && shouldExposeAppErrorDetails(appErrorCode)) {
        payload.details = error.details;
        if (error.details.fieldErrors) {
          payload.fieldErrors = error.details.fieldErrors;
        }
      }

      if (error.headers && typeof error.headers === "object") {
        Object.entries(error.headers).forEach(([name, value]) => {
          reply.header(name, value);
        });
      }

      reply.code(error.status).send(payload);
      return;
    }

    if (error.headers && typeof error.headers === "object") {
      Object.entries(error.headers).forEach(([name, value]) => {
        reply.header(name, value);
      });
    }

    if (statusCode >= 500) {
      recordDbError(error);
    }
    captureServerError(request, error, statusCode);
    app.log.error({ err: error }, unhandledErrorLogMessage);

    const message = statusCode >= 500 ? "Internal server error." : String(error?.message || "Request failed.");
    const fallbackErrorCode =
      normalizedErrorCode || (statusCode >= 500 ? "internal_server_error" : "request_failed");
    const payload = {
      error: message,
      code: fallbackErrorCode
    };
    if (isCsrfErrorCode) {
      payload.details = {
        code: normalizedErrorCode
      };
    }
    if (applyRouteTransportErrorResponse(reply, request, error, {
      statusCode,
      normalizedErrorCode: fallbackErrorCode
    })) {
      return;
    }
    reply.code(statusCode).send(payload);
  });
}

function ensureApiErrorHandling(
  app,
  {
    fastifyToken = "jskit.fastify",
    markerToken = "kernel.runtime.apiErrorHandlerRegistered",
    isAppError: isAppErrorOverride,
    autoRegister = true,
    ...handlerOptions
  } = {}
) {
  if (!app || typeof app.make !== "function" || typeof app.has !== "function" || typeof app.instance !== "function") {
    throw new TypeError("ensureApiErrorHandling requires an application instance.");
  }

  if (autoRegister === false) {
    return false;
  }

  const normalizedMarkerToken = String(markerToken || "").trim() || "kernel.runtime.apiErrorHandlerRegistered";
  if (app.has(normalizedMarkerToken)) {
    return false;
  }

  const fastify = app.make(fastifyToken);
  if (!fastify || typeof fastify.setErrorHandler !== "function") {
    throw new TypeError("ensureApiErrorHandling requires a Fastify instance.");
  }

  const appErrorPredicate = typeof isAppErrorOverride === "function" ? isAppErrorOverride : isAppError;
  registerApiErrorHandler(fastify, {
    ...handlerOptions,
    isAppError: appErrorPredicate
  });
  app.instance(normalizedMarkerToken, true);

  return true;
}

function resolveDatabaseErrorCode(error) {
  const errorCode = String(error?.code || "")
    .trim()
    .toUpperCase();
  if (errorCode && (errorCode.startsWith("ER_") || errorCode.startsWith("SQLITE_") || errorCode.startsWith("PG"))) {
    return errorCode;
  }

  const sqlState = String(error?.sqlState || error?.sqlstate || "")
    .trim()
    .toUpperCase();
  if (sqlState) {
    return `SQLSTATE_${sqlState}`;
  }

  const errno = Number(error?.errno);
  if (Number.isInteger(errno)) {
    return `ERRNO_${errno}`;
  }

  const message = String(error?.message || "").toLowerCase();
  const name = String(error?.name || "").toLowerCase();
  if (message.includes("mysql") || message.includes("sql") || message.includes("knex") || name.includes("mysql")) {
    return "DB_UNKNOWN";
  }

  return "";
}

function recordDbErrorBestEffort(observabilityService, error) {
  if (!observabilityService || typeof observabilityService.recordDbError !== "function") {
    return;
  }

  const code = resolveDatabaseErrorCode(error);
  if (!code) {
    return;
  }

  observabilityService.recordDbError({ code });
}

async function runGracefulShutdown({
  signal = "",
  exitProcess = false,
  exitCode = 0,
  timeoutMs = 10_000,
  appInstance = null,
  stopBackgroundRuntimes = () => {},
  closeDatabase = async () => {},
  logger = console
} = {}) {
  let forcedExitTimer = null;

  if (signal) {
    logger.log(`Received ${signal}. Shutting down.`);
  }

  stopBackgroundRuntimes();

  if (exitProcess) {
    forcedExitTimer = setTimeout(() => {
      try {
        appInstance?.server?.closeIdleConnections?.();
        appInstance?.server?.closeAllConnections?.();
      } catch {
        // Ignore best-effort force-close failures.
      }

      logger.error(`Graceful shutdown timed out after ${timeoutMs}ms. Forcing process exit.`);
      process.exit(1);
    }, timeoutMs);
    forcedExitTimer.unref?.();
  }

  try {
    if (appInstance) {
      await appInstance.close();
    }
    await closeDatabase();
  } catch (error) {
    logger.error("Failed to close server cleanly:", error);
    if (exitProcess) {
      process.exit(1);
    }
    throw error;
  } finally {
    if (forcedExitTimer) {
      clearTimeout(forcedExitTimer);
    }
  }

  if (exitProcess) {
    process.exit(exitCode);
  }
}

export {
  resolveLoggerLevel,
  createFastifyLoggerOptions,
  registerJsonApiContentTypeParser,
  registerRequestLoggingHooks,
  registerApiErrorHandler,
  ensureApiErrorHandling,
  resolveDatabaseErrorCode,
  recordDbErrorBestEffort,
  runGracefulShutdown
};
