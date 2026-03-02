import {
  buildPublishRequestMeta,
  publishSafely,
  resolvePublishMethod
} from "@jskit-ai/server-runtime-core/realtimePublish";

function resolvePublishChatEvent(realtimeEventsService) {
  return resolvePublishMethod(realtimeEventsService, "publishChatEvent");
}

function publishChatEventSafely({
  publishChatEvent,
  request,
  eventType,
  thread,
  targetUserIds,
  payload,
  logCode = "chat.realtime.publish_failed",
  logContext = {}
} = {}) {
  return publishSafely({
    publishMethod: publishChatEvent,
    payload: {
      eventType,
      thread,
      targetUserIds,
      payload,
      ...buildPublishRequestMeta(request)
    },
    request,
    logCode,
    logContext
  });
}

function createChatEventPublisher({ realtimeEventsService = null, logCode = "chat.realtime.publish_failed" } = {}) {
  const publishChatEvent = resolvePublishChatEvent(realtimeEventsService);

  return function publishChatEventForRequest({
    request,
    eventType,
    thread,
    targetUserIds,
    payload,
    logCode: overrideLogCode,
    logContext = {}
  } = {}) {
    return publishChatEventSafely({
      publishChatEvent,
      request,
      eventType,
      thread,
      targetUserIds,
      payload,
      logCode: overrideLogCode || logCode,
      logContext
    });
  };
}

export { createChatEventPublisher, publishChatEventSafely, resolvePublishChatEvent };
