import { buildPublishRequestMeta, publishSafely, resolvePublishMethod } from "./shared.js";

function resolvePublishProjectEvent(realtimeEventsService) {
  return resolvePublishMethod(realtimeEventsService, "publishProjectEvent");
}

function publishProjectEventSafely({
  publishProjectEvent,
  request,
  workspace = request?.workspace,
  project = null,
  operation = "",
  logCode = "projects.realtime.publish_failed",
  logContext = {}
} = {}) {
  if (!project) {
    return false;
  }

  return publishSafely({
    publishMethod: publishProjectEvent,
    payload: {
      operation,
      workspace,
      project,
      ...buildPublishRequestMeta(request)
    },
    request,
    logCode,
    logContext
  });
}

function createProjectEventPublisher({
  realtimeEventsService = null,
  logCode = "projects.realtime.publish_failed"
} = {}) {
  const publishProjectEvent = resolvePublishProjectEvent(realtimeEventsService);

  return function publishProjectEventForRequest({
    request,
    workspace = request?.workspace,
    project = null,
    operation = "",
    logCode: overrideLogCode,
    logContext = {}
  } = {}) {
    return publishProjectEventSafely({
      publishProjectEvent,
      request,
      workspace,
      project,
      operation,
      logCode: overrideLogCode || logCode,
      logContext
    });
  };
}

export { createProjectEventPublisher, publishProjectEventSafely, resolvePublishProjectEvent };
