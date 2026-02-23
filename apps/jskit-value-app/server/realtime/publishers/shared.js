function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function resolvePublishMethod(realtimeEventsService, methodName) {
  if (!realtimeEventsService || typeof methodName !== "string") {
    return null;
  }

  return typeof realtimeEventsService[methodName] === "function" ? realtimeEventsService[methodName] : null;
}

function buildPublishRequestMeta(request) {
  return {
    commandId: normalizeHeaderValue(request?.headers?.["x-command-id"]),
    sourceClientId: normalizeHeaderValue(request?.headers?.["x-client-id"]),
    actorUserId: request?.user?.id
  };
}

function warnPublishFailure({ request, error, logCode, logContext = {} }) {
  const warnLogger = request?.log && typeof request.log.warn === "function" ? request.log.warn.bind(request.log) : null;
  if (!warnLogger) {
    return;
  }

  warnLogger(
    {
      err: error,
      ...(logContext && typeof logContext === "object" ? logContext : {})
    },
    String(logCode || "realtime.publish_failed")
  );
}

function publishSafely({ publishMethod, payload, request, logCode, logContext = {} } = {}) {
  if (typeof publishMethod !== "function") {
    return false;
  }

  try {
    publishMethod(payload);
    return true;
  } catch (error) {
    warnPublishFailure({
      request,
      error,
      logCode,
      logContext
    });
    return false;
  }
}

export { buildPublishRequestMeta, normalizeHeaderValue, publishSafely, resolvePublishMethod };
