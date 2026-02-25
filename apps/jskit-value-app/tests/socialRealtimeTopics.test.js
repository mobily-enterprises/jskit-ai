import assert from "node:assert/strict";
import test from "node:test";

import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../shared/eventTypes.js";
import {
  getTopicRule,
  hasTopicPermission,
  isTopicAllowedForSurface,
  listRealtimeTopicsForSurface
} from "../shared/topicRegistry.js";

test("social realtime topics and event types are registered", () => {
  assert.equal(REALTIME_TOPICS.SOCIAL_FEED, "social_feed");
  assert.equal(REALTIME_TOPICS.SOCIAL_NOTIFICATIONS, "social_notifications");
  assert.equal(REALTIME_EVENT_TYPES.SOCIAL_FEED_UPDATED, "social.feed.updated");
  assert.equal(REALTIME_EVENT_TYPES.SOCIAL_NOTIFICATIONS_UPDATED, "social.notifications.updated");
});

test("social topics are allowed on app/admin surfaces and gated by social.read", () => {
  const appTopics = listRealtimeTopicsForSurface("app");
  const adminTopics = listRealtimeTopicsForSurface("admin");
  assert.ok(appTopics.includes(REALTIME_TOPICS.SOCIAL_FEED));
  assert.ok(appTopics.includes(REALTIME_TOPICS.SOCIAL_NOTIFICATIONS));
  assert.ok(adminTopics.includes(REALTIME_TOPICS.SOCIAL_FEED));
  assert.ok(adminTopics.includes(REALTIME_TOPICS.SOCIAL_NOTIFICATIONS));

  const socialFeedRule = getTopicRule(REALTIME_TOPICS.SOCIAL_FEED);
  const socialNotificationsRule = getTopicRule(REALTIME_TOPICS.SOCIAL_NOTIFICATIONS);
  assert.deepEqual(socialFeedRule.requiredAnyPermission, ["social.read"]);
  assert.deepEqual(socialNotificationsRule.requiredAnyPermission, ["social.read"]);

  assert.equal(isTopicAllowedForSurface(REALTIME_TOPICS.SOCIAL_FEED, "app"), true);
  assert.equal(isTopicAllowedForSurface(REALTIME_TOPICS.SOCIAL_FEED, "admin"), true);
  assert.equal(isTopicAllowedForSurface(REALTIME_TOPICS.SOCIAL_FEED, "console"), false);

  assert.equal(hasTopicPermission(REALTIME_TOPICS.SOCIAL_FEED, ["social.read"], "app"), true);
  assert.equal(hasTopicPermission(REALTIME_TOPICS.SOCIAL_FEED, ["projects.read"], "app"), false);
});
