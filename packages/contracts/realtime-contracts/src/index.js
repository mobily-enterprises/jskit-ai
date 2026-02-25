export { REALTIME_MESSAGE_TYPES, REALTIME_ERROR_CODES } from "./protocolTypes.js";
export {
  TOPIC_SCOPES,
  createTopicCatalog,
  listTopics,
  getTopicRule,
  resolveTopicScope,
  isWorkspaceScopedTopic,
  isUserScopedTopic,
  isSupportedTopic,
  isTopicAllowedForSurface,
  listTopicsForSurface,
  resolveRequiredPermissions,
  hasTopicPermission
} from "./topicCatalog.js";
