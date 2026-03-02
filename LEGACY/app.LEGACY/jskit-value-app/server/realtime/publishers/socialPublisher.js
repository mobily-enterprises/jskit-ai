import {
  buildPublishRequestMeta,
  publishSafely,
  resolvePublishMethod
} from "@jskit-ai/server-runtime-core/realtimePublish";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../shared/eventTypes.js";

function resolvePublishWorkspaceEvent(realtimeEventsService) {
  return resolvePublishMethod(realtimeEventsService, "publishWorkspaceEvent");
}

function publishSocialFeedUpdatedSafely({ publishWorkspaceEvent, request, workspace, postId = null, operation = "updated" } = {}) {
  return publishSafely({
    publishMethod: publishWorkspaceEvent,
    payload: {
      eventType: REALTIME_EVENT_TYPES.SOCIAL_FEED_UPDATED,
      topic: REALTIME_TOPICS.SOCIAL_FEED,
      workspace,
      entityType: "social_post",
      entityId: postId,
      payload: {
        operation,
        postId
      },
      ...buildPublishRequestMeta(request)
    },
    request,
    logCode: "social.realtime.feed.publish_failed",
    logContext: {
      postId,
      operation
    }
  });
}

function publishSocialNotificationsUpdatedSafely({ publishWorkspaceEvent, request, workspace, userId = null } = {}) {
  return publishSafely({
    publishMethod: publishWorkspaceEvent,
    payload: {
      eventType: REALTIME_EVENT_TYPES.SOCIAL_NOTIFICATIONS_UPDATED,
      topic: REALTIME_TOPICS.SOCIAL_NOTIFICATIONS,
      workspace,
      entityType: "user",
      entityId: userId,
      payload: {
        userId
      },
      ...buildPublishRequestMeta(request)
    },
    request,
    logCode: "social.realtime.notifications.publish_failed",
    logContext: {
      userId
    }
  });
}

function createSocialEventPublisher({ realtimeEventsService = null } = {}) {
  const publishWorkspaceEvent = resolvePublishWorkspaceEvent(realtimeEventsService);

  return {
    publishSocialFeedUpdated({ request, workspace, postId = null, operation = "updated" } = {}) {
      return publishSocialFeedUpdatedSafely({
        publishWorkspaceEvent,
        request,
        workspace,
        postId,
        operation
      });
    },
    publishSocialNotificationsUpdated({ request, workspace, userId = null } = {}) {
      return publishSocialNotificationsUpdatedSafely({
        publishWorkspaceEvent,
        request,
        workspace,
        userId
      });
    }
  };
}

export {
  createSocialEventPublisher,
  resolvePublishWorkspaceEvent,
  publishSocialFeedUpdatedSafely,
  publishSocialNotificationsUpdatedSafely
};
