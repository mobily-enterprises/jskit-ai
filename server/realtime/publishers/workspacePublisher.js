import { buildPublishRequestMeta, publishSafely, resolvePublishMethod } from "./shared.js";

function resolvePublishWorkspaceEvent(realtimeEventsService) {
  return resolvePublishMethod(realtimeEventsService, "publishWorkspaceEvent");
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
  return publishSafely({
    publishMethod: publishWorkspaceEvent,
    payload: {
      eventType,
      topic,
      workspace,
      entityType,
      entityId,
      payload,
      ...buildPublishRequestMeta(request)
    },
    request,
    logCode,
    logContext
  });
}

function createWorkspaceEventPublisher({
  realtimeEventsService = null,
  logCode = "workspace.realtime.publish_failed"
} = {}) {
  const publishWorkspaceEvent = resolvePublishWorkspaceEvent(realtimeEventsService);

  return function publishWorkspaceEventForRequest({
    request,
    workspace = request?.workspace,
    topic,
    eventType,
    entityType = "workspace",
    entityId = workspace?.id,
    payload = {},
    logCode: overrideLogCode,
    logContext = {}
  } = {}) {
    return publishWorkspaceEventSafely({
      publishWorkspaceEvent,
      request,
      workspace,
      topic,
      eventType,
      entityType,
      entityId,
      payload,
      logCode: overrideLogCode || logCode,
      logContext
    });
  };
}

export { createWorkspaceEventPublisher, publishWorkspaceEventSafely, resolvePublishWorkspaceEvent };
