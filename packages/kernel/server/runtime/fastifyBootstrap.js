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

function registerRequestLoggingHooks(
  app,
  {
    requestStartedAtSymbol,
    getPathname,
    getSurface,
    observeRequest,
    enableRequestLogs = true
  } = {}
) {
  if (!app || typeof app.addHook !== "function") {
    throw new TypeError("registerRequestLoggingHooks requires a Fastify instance.");
  }

  const startedAtSymbol = requestStartedAtSymbol || Symbol("request_started_at_ns");
  const resolvePathname = typeof getPathname === "function" ? getPathname : () => "/";
  const resolveSurface = typeof getSurface === "function" ? getSurface : () => "app";

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
    const userId = Number(request?.user?.id);
    const logPayload = {
      requestId: String(request?.id || ""),
      method: String(request?.method || ""),
      path: pathnameValue,
      routeUrl,
      surface,
      statusCode: Number(reply?.statusCode || 0),
      durationMs: Number.isFinite(durationMs) ? Number(durationMs.toFixed(3)) : null
    };

    if (Number.isInteger(userId) && userId > 0) {
      logPayload.userId = userId;
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

  app.setErrorHandler((error, request, reply) => {
    const normalizedErrorCode = String(error?.code || "").trim();
    const isCsrfErrorCode = normalizedErrorCode.startsWith("FST_CSRF_");
    const statusFromError = Number(error?.statusCode || error?.status);
    const statusCode =
      Number.isInteger(statusFromError) && statusFromError >= 400 && statusFromError <= 599 ? statusFromError : 500;

    if (Array.isArray(error?.validation)) {
      const fieldErrors = resolveValidationFieldErrors(error);
      reply.code(400).send({
        error: "Validation failed.",
        fieldErrors,
        details: {
          fieldErrors
        }
      });
      return;
    }

    if (isAppError(error)) {
      if (error.status >= 500) {
        recordDbError(error);
        captureServerError(request, error, error.status);
        app.log.error({ err: error }, appErrorLogMessage);
      }

      const payload = { error: error.message };
      if (error.details) {
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
    const payload = { error: message };
    if (isCsrfErrorCode) {
      payload.details = {
        code: normalizedErrorCode
      };
    }
    reply.code(statusCode).send(payload);
  });
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
  registerRequestLoggingHooks,
  registerApiErrorHandler,
  resolveDatabaseErrorCode,
  recordDbErrorBestEffort,
  runGracefulShutdown
};
