import {
  MAX_INBOUND_MESSAGE_BYTES,
  SOCKET_IO_MESSAGE_EVENT,
  SOCKET_IO_PATH,
  __testables,
  registerRealtimeServerSocketio
} from "@jskit-ai/realtime-server-socketio";
import { API_REALTIME_PATH } from "../../shared/apiPaths.js";

import { hasTopicPermission, isSupportedTopic, isTopicAllowedForSurface } from "../../shared/topicRegistry.js";
import {
  buildSubscribeContextRequest,
  normalizeConnectionSurface,
  normalizeWorkspaceSlug
} from "../fastify/realtime/subscribeContext.js";

/**
 * App-level realtime registration boundary.
 *
 * First-day explanation:
 * This file is intentionally small. The shared package owns transport/runtime mechanics
 * (Socket.IO server lifecycle, protocol handling, fanout, Redis adapter wiring).
 * The app owns business policy (topic vocabulary, surface rules, permission checks,
 * workspace request shaping).
 *
 * This function does exactly 2 jobs:
 * 1) Accept app runtime dependencies (services + runtime options) from server bootstrap.
 * 2) Inject app policy callbacks into the shared runtime.
 *
 * It does NOT:
 * 1) Implement websocket protocol mechanics.
 * 2) Implement Redis adapter lifecycle logic.
 * 3) Provide compatibility translation for old APIs.
 *
 * Call flow:
 * server.js -> registerSocketIoRealtime(...) -> registerRealtimeServerSocketio(...)
 */
async function registerSocketIoRealtime(
  fastify,
  {
    authService,
    realtimeEventsService,
    workspaceService,
    redisUrl = "",
    requireRedisAdapter = false,
    logger = null,
    path = API_REALTIME_PATH,
    maxInboundMessageBytes = MAX_INBOUND_MESSAGE_BYTES,
    redisQuitTimeoutMs,
    redisConnectTimeoutMs,
    redisClientFactory,
    redisStreamsAdapterFactory
  }
) {
  const runtimeDeps = {
    authService,
    realtimeEventsService,
    workspaceService
  };

  const appPolicyCallbacks = {
    isSupportedTopic,
    isTopicAllowedForSurface,
    hasTopicPermission,
    buildSubscribeContextRequest,
    normalizeConnectionSurface,
    normalizeWorkspaceSlug
  };

  const runtimeOptions = {
    redisUrl,
    requireRedisAdapter,
    logger,
    path,
    maxInboundMessageBytes,
    redisQuitTimeoutMs,
    redisConnectTimeoutMs,
    redisClientFactory,
    redisStreamsAdapterFactory
  };

  return registerRealtimeServerSocketio(fastify, {
    ...runtimeDeps,
    ...appPolicyCallbacks,
    ...runtimeOptions
  });
}

export { registerSocketIoRealtime, SOCKET_IO_PATH, SOCKET_IO_MESSAGE_EVENT, MAX_INBOUND_MESSAGE_BYTES, __testables };
