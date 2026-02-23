import {
  MAX_INBOUND_MESSAGE_BYTES,
  SOCKET_IO_MESSAGE_EVENT,
  SOCKET_IO_PATH,
  __testables,
  registerRealtimeServerSocketio
} from "@jskit-ai/realtime-server-socketio";

import { hasTopicPermission, isSupportedTopic, isTopicAllowedForSurface } from "../../shared/realtime/topicRegistry.js";
import {
  buildSubscribeContextRequest,
  normalizeConnectionSurface,
  normalizeWorkspaceSlug
} from "../fastify/realtime/subscribeContext.js";

async function registerSocketIoRealtime(
  fastify,
  {
    authService,
    realtimeEventsService,
    workspaceService,
    redisUrl = "",
    requireRedisAdapter = false,
    logger = null,
    path = SOCKET_IO_PATH,
    maxInboundMessageBytes = MAX_INBOUND_MESSAGE_BYTES,
    redisQuitTimeoutMs,
    redisConnectTimeoutMs,
    redisClientFactory,
    redisStreamsAdapterFactory
  }
) {
  return registerRealtimeServerSocketio(fastify, {
    authService,
    realtimeEventsService,
    workspaceService,
    isSupportedTopic,
    isTopicAllowedForSurface,
    hasTopicPermission,
    buildSubscribeContextRequest,
    normalizeConnectionSurface,
    normalizeWorkspaceSlug,
    redisUrl,
    requireRedisAdapter,
    logger,
    path,
    maxInboundMessageBytes,
    redisQuitTimeoutMs,
    redisConnectTimeoutMs,
    redisClientFactory,
    redisStreamsAdapterFactory
  });
}

export { registerSocketIoRealtime, SOCKET_IO_PATH, SOCKET_IO_MESSAGE_EVENT, MAX_INBOUND_MESSAGE_BYTES, __testables };
