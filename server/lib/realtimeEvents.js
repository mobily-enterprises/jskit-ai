function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function resolvePublishWorkspaceEvent(realtimeEventsService) {
  return realtimeEventsService && typeof realtimeEventsService.publishWorkspaceEvent === "function"
    ? realtimeEventsService.publishWorkspaceEvent
    : null;
}

function publishWorkspaceEventSafely({
  publishWorkspaceEvent,
  request,
  workspace = request?.workspace,
  topic,
  eventType,
  entityType = "workspace",
  entityId = workspace?.id,
  payload = {},
  logCode = "workspace.realtime.publish_failed",
  logContext = {}
} = {}) {
  if (typeof publishWorkspaceEvent !== "function") {
    return false;
  }

  try {
    publishWorkspaceEvent({
      eventType,
      topic,
      workspace,
      entityType,
      entityId,
      commandId: normalizeHeaderValue(request?.headers?.["x-command-id"]),
      sourceClientId: normalizeHeaderValue(request?.headers?.["x-client-id"]),
      actorUserId: request?.user?.id,
      payload
    });
    return true;
  } catch (error) {
    const warnLogger = request?.log && typeof request.log.warn === "function" ? request.log.warn.bind(request.log) : null;
    if (warnLogger) {
      warnLogger(
        {
          err: error,
          ...(logContext && typeof logContext === "object" ? logContext : {})
        },
        String(logCode || "workspace.realtime.publish_failed")
      );
    }

    return false;
  }
}

export { resolvePublishWorkspaceEvent, publishWorkspaceEventSafely };
