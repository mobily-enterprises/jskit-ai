import { createAdapter as createRedisStreamsAdapter } from "@socket.io/redis-streams-adapter";
import { createClient as createRedisClient } from "redis";
import { Server as SocketIoServer } from "socket.io";

import { REALTIME_ERROR_CODES, REALTIME_MESSAGE_TYPES } from "@jskit-ai/realtime-contracts";

const SOCKET_IO_PATH = "/api/v1/realtime";
const SOCKET_IO_MESSAGE_EVENT = "realtime:message";
const MAX_INBOUND_MESSAGE_BYTES = 8192;
const REDIS_QUIT_TIMEOUT_MS = 5000;
const REDIS_CONNECT_TIMEOUT_MS = 5000;
const TOPIC_SCOPES = Object.freeze({
  WORKSPACE: "workspace",
  USER: "user"
});

function normalizeRequestId(requestIdValue) {
  const requestId = String(requestIdValue || "").trim();
  return requestId || null;
}

function normalizeTopics(topicsValue) {
  if (!Array.isArray(topicsValue)) {
    return [];
  }

  return [...new Set(topicsValue.map((topic) => String(topic || "").trim()).filter(Boolean))];
}

function normalizeTopicScope(scopeValue) {
  const normalizedScope = String(scopeValue || "")
    .trim()
    .toLowerCase();
  if (normalizedScope === TOPIC_SCOPES.USER) {
    return TOPIC_SCOPES.USER;
  }
  return TOPIC_SCOPES.WORKSPACE;
}

function buildWorkspaceSubscriptionKey(workspaceId, topic) {
  return `workspace:${Number(workspaceId)}:${String(topic || "").trim()}`;
}

function buildWorkspaceRoomName(workspaceId, topic) {
  return `w:${Number(workspaceId)}:t:${String(topic || "").trim()}`;
}

function buildUserRoomName(userId) {
  return `u:${Number(userId)}`;
}

function buildUserTopicSubscriptionKey(userId, topic) {
  return `user:${Number(userId)}:${String(topic || "").trim()}`;
}

function buildUserTopicRoomName(userId, topic) {
  return `u:${Number(userId)}:t:${String(topic || "").trim()}`;
}

function normalizeTargetUserIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const entry of value) {
    const userId = Number(entry);
    if (!Number.isInteger(userId) || userId < 1 || seen.has(userId)) {
      continue;
    }

    seen.add(userId);
    normalized.push(userId);
  }

  return normalized;
}

function buildProtocolErrorMessage(code) {
  if (code === REALTIME_ERROR_CODES.WORKSPACE_REQUIRED) {
    return "Workspace slug is required.";
  }
  if (code === REALTIME_ERROR_CODES.UNAUTHORIZED) {
    return "Authentication required.";
  }
  if (code === REALTIME_ERROR_CODES.FORBIDDEN) {
    return "Forbidden.";
  }
  if (code === REALTIME_ERROR_CODES.UNSUPPORTED_TOPIC) {
    return "Unsupported topic.";
  }
  if (code === REALTIME_ERROR_CODES.UNSUPPORTED_SURFACE) {
    return "Unsupported surface.";
  }
  if (code === REALTIME_ERROR_CODES.PAYLOAD_TOO_LARGE) {
    return "Payload too large.";
  }
  if (code === REALTIME_ERROR_CODES.INVALID_MESSAGE) {
    return "Invalid realtime message.";
  }

  return "Internal server error.";
}

function createProtocolErrorPayload({ requestId, code, message }) {
  const payload = {
    type: REALTIME_MESSAGE_TYPES.ERROR,
    code,
    message
  };

  const normalizedRequestId = normalizeRequestId(requestId);
  if (normalizedRequestId) {
    payload.requestId = normalizedRequestId;
  }

  return payload;
}

function createAckPayload({ type, requestId, workspaceSlug, topics }) {
  const payload = {
    type,
    workspaceSlug,
    topics
  };

  const normalizedRequestId = normalizeRequestId(requestId);
  if (normalizedRequestId) {
    payload.requestId = normalizedRequestId;
  }

  return payload;
}

function createPongPayload({ requestId, ts }) {
  const payload = {
    type: REALTIME_MESSAGE_TYPES.PONG,
    ts: String(ts || new Date().toISOString())
  };

  const normalizedRequestId = normalizeRequestId(requestId);
  if (normalizedRequestId) {
    payload.requestId = normalizedRequestId;
  }

  return payload;
}

function parseCookieHeader(cookieHeader) {
  const parsed = {};
  const source = String(cookieHeader || "").trim();
  if (!source) {
    return parsed;
  }

  for (const entry of source.split(";")) {
    const [rawName, ...rawValueParts] = String(entry || "").split("=");
    const name = String(rawName || "").trim();
    if (!name) {
      continue;
    }

    const rawValue = rawValueParts.join("=").trim();
    try {
      parsed[name] = decodeURIComponent(rawValue);
    } catch {
      parsed[name] = rawValue;
    }
  }

  return parsed;
}

function resolveConnectionSurface(socket, normalizeConnectionSurfaceFn) {
  const handshakeQuery =
    socket?.handshake?.query && typeof socket.handshake.query === "object" ? socket.handshake.query : {};
  const hasSurfaceQuery = Object.hasOwn(handshakeQuery, "surface");
  const querySurfaceValue = hasSurfaceQuery
    ? Array.isArray(handshakeQuery.surface)
      ? handshakeQuery.surface[0]
      : handshakeQuery.surface
    : "";

  if (hasSurfaceQuery) {
    const normalizedQuerySurface = String(querySurfaceValue || "")
      .trim()
      .toLowerCase();
    if (!normalizedQuerySurface) {
      return "";
    }
  }

  return normalizeConnectionSurfaceFn(querySurfaceValue || "");
}

function getMessageByteLength(messagePayload) {
  try {
    return Buffer.byteLength(JSON.stringify(messagePayload), "utf8");
  } catch {
    return MAX_INBOUND_MESSAGE_BYTES + 1;
  }
}

function buildSocketRequestContext(socket, path = SOCKET_IO_PATH) {
  const handshakeHeaders =
    socket?.handshake?.headers && typeof socket.handshake.headers === "object" ? socket.handshake.headers : {};
  const handshakeQuery =
    socket?.handshake?.query && typeof socket.handshake.query === "object" ? socket.handshake.query : {};
  const cookieHeader = String(handshakeHeaders.cookie || "");

  const query = {};
  for (const [key, value] of Object.entries(handshakeQuery)) {
    query[key] = Array.isArray(value) ? value[0] : value;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null) {
      continue;
    }
    searchParams.append(key, String(value));
  }
  const queryString = searchParams.toString();
  const rawUrl = queryString ? `${path}?${queryString}` : path;

  return {
    headers: {
      ...handshakeHeaders,
      cookie: cookieHeader
    },
    cookies: parseCookieHeader(cookieHeader),
    query,
    params: {},
    url: rawUrl,
    raw: {
      url: rawUrl,
      socket: {
        remoteAddress: socket?.handshake?.address || ""
      }
    },
    ip: socket?.handshake?.address || ""
  };
}

function emitMessage(socket, payload) {
  try {
    socket.emit(SOCKET_IO_MESSAGE_EVENT, payload);
    return true;
  } catch {
    return false;
  }
}

function emitProtocolError(socket, { requestId, code }) {
  return emitMessage(
    socket,
    createProtocolErrorPayload({
      requestId,
      code,
      message: buildProtocolErrorMessage(code)
    })
  );
}

function createSocketMiddlewareError(code) {
  const message = buildProtocolErrorMessage(code);
  const error = new Error(message);
  error.data = {
    code,
    message
  };
  return error;
}

function createLogger(logger = null) {
  return {
    info(payload, message) {
      if (logger && typeof logger.info === "function") {
        logger.info(payload, message);
      }
    },
    warn(payload, message) {
      if (logger && typeof logger.warn === "function") {
        logger.warn(payload, message);
      }
    }
  };
}

function normalizeRedisQuitTimeoutMs(value, fallback = REDIS_QUIT_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, 60_000);
}

function normalizeRedisConnectTimeoutMs(value, fallback = REDIS_CONNECT_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, 60_000);
}

async function connectRedisClientWithTimeout(redisClient, { timeoutMs = REDIS_CONNECT_TIMEOUT_MS } = {}) {
  if (!redisClient || typeof redisClient.connect !== "function") {
    throw new Error("Redis client with connect() is required.");
  }

  const normalizedTimeoutMs = normalizeRedisConnectTimeoutMs(timeoutMs, REDIS_CONNECT_TIMEOUT_MS);
  let timeoutHandle = null;
  let timedOut = false;
  const connectPromise = redisClient.connect();
  if (connectPromise && typeof connectPromise.catch === "function") {
    connectPromise.catch(() => {
      // Prevent unhandled rejections when timeout wins.
    });
  }

  try {
    await Promise.race([
      connectPromise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Redis connect timed out after ${normalizedTimeoutMs}ms.`));
        }, normalizedTimeoutMs);
      })
    ]);
  } catch (error) {
    if (timedOut) {
      error.code = "REDIS_CONNECT_TIMEOUT";
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }
}

async function closeRedisClientWithTimeout(redisClient, { timeoutMs = REDIS_QUIT_TIMEOUT_MS } = {}) {
  if (!redisClient) {
    return;
  }

  const normalizedTimeoutMs = normalizeRedisQuitTimeoutMs(timeoutMs, REDIS_QUIT_TIMEOUT_MS);
  let timeoutHandle = null;
  let timedOut = false;

  if (typeof redisClient.quit === "function") {
    try {
      await Promise.race([
        redisClient.quit(),
        new Promise((resolve) => {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            resolve();
          }, normalizedTimeoutMs);
        })
      ]);
    } catch {
      // Fall through to force disconnect.
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    }
  }

  const stillOpen = typeof redisClient.isOpen === "boolean" ? redisClient.isOpen : true;
  if (!timedOut && !stillOpen) {
    return;
  }

  if (typeof redisClient.disconnect === "function") {
    try {
      redisClient.disconnect();
      return;
    } catch {
      // fall through
    }
  }

  if (typeof redisClient.destroy === "function") {
    try {
      redisClient.destroy();
    } catch {
      // ignore hard-close failures during shutdown
    }
  }
}

async function registerRealtimeServerSocketio(
  fastify,
  {
    authService,
    realtimeEventsService,
    workspaceService,
    isSupportedTopic,
    getTopicScope,
    isTopicAllowedForSurface,
    hasTopicPermission,
    buildSubscribeContextRequest,
    normalizeConnectionSurface,
    normalizeWorkspaceSlug,
    redisUrl = "",
    requireRedisAdapter = false,
    logger = null,
    path = SOCKET_IO_PATH,
    maxInboundMessageBytes = MAX_INBOUND_MESSAGE_BYTES,
    redisQuitTimeoutMs = REDIS_QUIT_TIMEOUT_MS,
    redisConnectTimeoutMs = REDIS_CONNECT_TIMEOUT_MS,
    redisClientFactory = createRedisClient,
    redisStreamsAdapterFactory = createRedisStreamsAdapter
  }
) {
  if (!authService || typeof authService.authenticateRequest !== "function") {
    throw new Error("authService is required.");
  }
  if (!realtimeEventsService || typeof realtimeEventsService.subscribe !== "function") {
    throw new Error("realtimeEventsService is required.");
  }
  if (!workspaceService || typeof workspaceService.resolveRequestContext !== "function") {
    throw new Error("workspaceService is required.");
  }
  if (typeof isSupportedTopic !== "function") {
    throw new Error("isSupportedTopic is required.");
  }
  if (typeof getTopicScope !== "function") {
    throw new Error("getTopicScope is required.");
  }
  if (typeof isTopicAllowedForSurface !== "function") {
    throw new Error("isTopicAllowedForSurface is required.");
  }
  if (typeof hasTopicPermission !== "function") {
    throw new Error("hasTopicPermission is required.");
  }
  if (typeof buildSubscribeContextRequest !== "function") {
    throw new Error("buildSubscribeContextRequest is required.");
  }
  if (typeof normalizeConnectionSurface !== "function") {
    throw new Error("normalizeConnectionSurface is required.");
  }
  if (typeof normalizeWorkspaceSlug !== "function") {
    throw new Error("normalizeWorkspaceSlug is required.");
  }

  const appLogger = createLogger(logger || fastify?.log || null);
  const normalizedRedisUrl = String(redisUrl || "").trim();
  if (requireRedisAdapter && !normalizedRedisUrl) {
    throw new Error("REDIS_URL is required to run Socket.IO realtime with the Redis Streams adapter.");
  }

  const io = new SocketIoServer(fastify.server, {
    path,
    transports: ["websocket"],
    serveClient: false,
    maxHttpBufferSize: maxInboundMessageBytes,
    cors: false
  });

  let redisClient = null;
  let usingRedisAdapter = false;
  if (normalizedRedisUrl) {
    redisClient = redisClientFactory({
      url: normalizedRedisUrl
    });
    redisClient.on("error", (error) => {
      appLogger.warn(
        {
          err: error
        },
        "realtime.redis.error"
      );
    });

    try {
      await connectRedisClientWithTimeout(redisClient, {
        timeoutMs: redisConnectTimeoutMs
      });
      io.adapter(redisStreamsAdapterFactory(redisClient));
      usingRedisAdapter = true;

      appLogger.info(
        {
          path,
          adapter: "redis-streams"
        },
        "realtime.socketio.started"
      );
    } catch (error) {
      await closeRedisClientWithTimeout(redisClient, {
        timeoutMs: redisQuitTimeoutMs
      });
      redisClient = null;

      if (requireRedisAdapter) {
        const startupError = new Error(
          "Failed to connect Redis Streams adapter for realtime startup. Verify REDIS_URL connectivity."
        );
        startupError.cause = error;
        throw startupError;
      }

      appLogger.warn(
        {
          err: error,
          path
        },
        "realtime.socketio.redis_unavailable_falling_back_to_memory"
      );
    }
  }

  if (!usingRedisAdapter) {
    appLogger.warn(
      {
        path
      },
      "realtime.socketio.started_without_redis"
    );
  }

  async function resolveSubscribeAuthorization(socket, workspaceSlug, surfaceId) {
    const baseRequest = socket?.data?.requestContext || buildSocketRequestContext(socket, path);
    const subscribeRequest = buildSubscribeContextRequest(baseRequest, workspaceSlug, surfaceId);
    const context = await workspaceService.resolveRequestContext({
      user: socket?.data?.user || null,
      request: subscribeRequest,
      workspacePolicy: "required",
      workspaceSurface: surfaceId
    });

    if (!context?.workspace) {
      return null;
    }

    return context;
  }

  function partitionTopicsByScope(topics) {
    const workspaceTopics = [];
    const userTopics = [];

    for (const topic of topics) {
      let normalizedScope = TOPIC_SCOPES.WORKSPACE;
      try {
        normalizedScope = normalizeTopicScope(getTopicScope(topic));
      } catch {
        normalizedScope = TOPIC_SCOPES.WORKSPACE;
      }

      if (normalizedScope === TOPIC_SCOPES.USER) {
        userTopics.push(topic);
        continue;
      }

      workspaceTopics.push(topic);
    }

    return {
      workspaceTopics,
      userTopics
    };
  }

  function resolveSubscriptionRoomName(subscription) {
    const topic = String(subscription?.topic || "").trim();
    if (!topic) {
      return "";
    }

    const scope = normalizeTopicScope(subscription?.scope);
    if (scope === TOPIC_SCOPES.USER) {
      const userId = Number(subscription?.userId);
      if (!Number.isInteger(userId) || userId < 1) {
        return "";
      }
      return buildUserTopicRoomName(userId, topic);
    }

    const workspaceId = Number(subscription?.workspaceId);
    if (!Number.isInteger(workspaceId) || workspaceId < 1) {
      return "";
    }
    return buildWorkspaceRoomName(workspaceId, topic);
  }

  function removeConnectionSubscriptions(socket) {
    const subscriptions = socket?.data?.subscriptions;
    if (!(subscriptions instanceof Map)) {
      return;
    }

    for (const [subscriptionKey, subscription] of subscriptions.entries()) {
      const roomName = resolveSubscriptionRoomName(subscription);
      if (roomName) {
        socket.leave(roomName);
      }
      subscriptions.delete(subscriptionKey);
    }
  }

  function normalizeSocketSurface(surfaceValue) {
    const normalizedSurface = String(surfaceValue || "")
      .trim()
      .toLowerCase();
    if (!normalizedSurface) {
      return "";
    }

    return normalizeConnectionSurface(normalizedSurface);
  }

  function normalizeSocketUserProfile(userValue) {
    const userId = Number(userValue?.id);
    if (!Number.isInteger(userId) || userId < 1) {
      return null;
    }

    return {
      id: userId,
      email: String(userValue?.email || ""),
      displayName: String(userValue?.displayName || "")
    };
  }

  function buildSocketEventAuthRequest(socket, workspaceSlug, surfaceId) {
    const baseRequest =
      socket?.data?.requestContext && typeof socket.data.requestContext === "object"
        ? socket.data.requestContext
        : {
            headers: {},
            cookies: {},
            query: {},
            params: {},
            url: path,
            raw: {
              url: path,
              socket: {
                remoteAddress: ""
              }
            },
            ip: ""
          };

    return buildSubscribeContextRequest(baseRequest, workspaceSlug, surfaceId);
  }

  async function evictWorkspaceSocketSubscription(socket, { workspaceId, topic }) {
    const roomName = buildWorkspaceRoomName(workspaceId, topic);
    const subscriptions = socket?.data?.subscriptions;
    if (subscriptions instanceof Map) {
      subscriptions.delete(buildWorkspaceSubscriptionKey(workspaceId, topic));
    }

    try {
      await Promise.resolve(socket.leave(roomName));
    } catch {
      // Best-effort room eviction.
    }
  }

  async function evictUserTopicSocketSubscription(socket, { userId, topic }) {
    const roomName = buildUserTopicRoomName(userId, topic);
    const subscriptions = socket?.data?.subscriptions;
    if (subscriptions instanceof Map) {
      subscriptions.delete(buildUserTopicSubscriptionKey(userId, topic));
    }

    try {
      await Promise.resolve(socket.leave(roomName));
    } catch {
      // Best-effort room eviction.
    }
  }

  async function canSocketReceiveEvent(socket, { workspaceId, workspaceSlug, topic }) {
    const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlug);
    if (!normalizedWorkspaceSlug) {
      return {
        allowed: false,
        evict: false
      };
    }

    const surfaceId = normalizeSocketSurface(socket?.data?.surface);
    if (!surfaceId || !isTopicAllowedForSurface(topic, surfaceId)) {
      return {
        allowed: false,
        evict: true
      };
    }

    const user = normalizeSocketUserProfile(socket?.data?.user);
    if (!user) {
      return {
        allowed: false,
        evict: true
      };
    }

    let subscribeRequest;
    try {
      subscribeRequest = buildSocketEventAuthRequest(socket, normalizedWorkspaceSlug, surfaceId);
    } catch {
      return {
        allowed: false,
        evict: false
      };
    }

    try {
      const context = await workspaceService.resolveRequestContext({
        user,
        request: subscribeRequest,
        workspacePolicy: "required",
        workspaceSurface: surfaceId
      });
      const resolvedWorkspaceId = Number(context?.workspace?.id);
      if (!Number.isInteger(resolvedWorkspaceId) || resolvedWorkspaceId !== workspaceId) {
        return {
          allowed: false,
          evict: true
        };
      }

      const allowed = hasTopicPermission(topic, context?.permissions, surfaceId);
      return {
        allowed,
        evict: !allowed
      };
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status || 0);
      if (statusCode === 401 || statusCode === 403 || statusCode === 409) {
        return {
          allowed: false,
          evict: true
        };
      }

      appLogger.warn(
        {
          err: error,
          socketId: String(socket?.id || ""),
          workspaceId,
          workspaceSlug: normalizedWorkspaceSlug,
          topic
        },
        "realtime.socketio.event_authorization_failed"
      );
      return {
        allowed: false,
        evict: false
      };
    }
  }

  async function emitEventMessage(socket, eventEnvelope) {
    try {
      await Promise.resolve(
        socket.emit(SOCKET_IO_MESSAGE_EVENT, {
          type: REALTIME_MESSAGE_TYPES.EVENT,
          event: eventEnvelope
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  function validateTopicsOrError(socket, requestId, topics) {
    if (!Array.isArray(topics) || topics.length < 1) {
      emitProtocolError(socket, {
        requestId,
        code: REALTIME_ERROR_CODES.INVALID_MESSAGE
      });
      return false;
    }

    for (const topic of topics) {
      if (!isSupportedTopic(topic)) {
        emitProtocolError(socket, {
          requestId,
          code: REALTIME_ERROR_CODES.UNSUPPORTED_TOPIC
        });
        return false;
      }
    }

    return true;
  }

  function validateTopicSurfacesOrError(socket, requestId, topics) {
    for (const topic of topics) {
      if (!isTopicAllowedForSurface(topic, socket?.data?.surface || "")) {
        emitProtocolError(socket, {
          requestId,
          code: REALTIME_ERROR_CODES.FORBIDDEN
        });
        return false;
      }
    }

    return true;
  }

  function validateTopicPermissionsOrError(socket, requestId, topics, permissions) {
    for (const topic of topics) {
      if (!hasTopicPermission(topic, permissions, socket?.data?.surface || "")) {
        emitProtocolError(socket, {
          requestId,
          code: REALTIME_ERROR_CODES.FORBIDDEN
        });
        return false;
      }
    }

    return true;
  }

  async function handleSubscribe(socket, message) {
    const requestId = message?.requestId;
    const workspaceSlug = normalizeWorkspaceSlug(message?.workspaceSlug);
    const topics = normalizeTopics(message?.topics);

    if (!validateTopicsOrError(socket, requestId, topics)) {
      return;
    }
    if (!validateTopicSurfacesOrError(socket, requestId, topics)) {
      return;
    }

    const { workspaceTopics, userTopics } = partitionTopicsByScope(topics);
    if (workspaceTopics.length > 0 && !workspaceSlug) {
      emitProtocolError(socket, {
        requestId,
        code: REALTIME_ERROR_CODES.WORKSPACE_REQUIRED
      });
      return;
    }

    let resolvedContext;
    if (workspaceTopics.length > 0) {
      try {
        resolvedContext = await resolveSubscribeAuthorization(socket, workspaceSlug, socket?.data?.surface || "");
      } catch (error) {
        const statusCode = Number(error?.statusCode || error?.status);
        if (statusCode === 401) {
          emitProtocolError(socket, {
            requestId,
            code: REALTIME_ERROR_CODES.UNAUTHORIZED
          });
          return;
        }
        if (statusCode === 403 || statusCode === 409) {
          emitProtocolError(socket, {
            requestId,
            code: REALTIME_ERROR_CODES.FORBIDDEN
          });
          return;
        }

        emitProtocolError(socket, {
          requestId,
          code: REALTIME_ERROR_CODES.INTERNAL_ERROR
        });
        return;
      }

      if (!resolvedContext) {
        emitProtocolError(socket, {
          requestId,
          code: REALTIME_ERROR_CODES.FORBIDDEN
        });
        return;
      }
    }

    const permissions = Array.isArray(resolvedContext?.permissions) ? resolvedContext.permissions : [];
    if (!validateTopicPermissionsOrError(socket, requestId, workspaceTopics, permissions)) {
      return;
    }
    if (!validateTopicPermissionsOrError(socket, requestId, userTopics, permissions)) {
      return;
    }

    const subscriptions = socket?.data?.subscriptions;
    if (!(subscriptions instanceof Map)) {
      emitProtocolError(socket, {
        requestId,
        code: REALTIME_ERROR_CODES.INTERNAL_ERROR
      });
      return;
    }

    const socketUserId = Number(socket?.data?.user?.id);
    if (userTopics.length > 0 && (!Number.isInteger(socketUserId) || socketUserId < 1)) {
      emitProtocolError(socket, {
        requestId,
        code: REALTIME_ERROR_CODES.UNAUTHORIZED
      });
      return;
    }

    if (workspaceTopics.length > 0) {
      const workspaceId = Number(resolvedContext?.workspace?.id);
      for (const topic of workspaceTopics) {
        const subscriptionKey = buildWorkspaceSubscriptionKey(workspaceId, topic);
        if (!subscriptions.has(subscriptionKey)) {
          subscriptions.set(subscriptionKey, {
            scope: TOPIC_SCOPES.WORKSPACE,
            workspaceId,
            workspaceSlug,
            topic
          });
        }

        socket.join(buildWorkspaceRoomName(workspaceId, topic));
      }
    }

    for (const topic of userTopics) {
      const subscriptionKey = buildUserTopicSubscriptionKey(socketUserId, topic);
      if (!subscriptions.has(subscriptionKey)) {
        subscriptions.set(subscriptionKey, {
          scope: TOPIC_SCOPES.USER,
          userId: socketUserId,
          topic
        });
      }

      socket.join(buildUserTopicRoomName(socketUserId, topic));
    }

    emitMessage(
      socket,
      createAckPayload({
        type: REALTIME_MESSAGE_TYPES.SUBSCRIBED,
        requestId,
        workspaceSlug,
        topics
      })
    );
  }

  async function handleUnsubscribe(socket, message) {
    const requestId = message?.requestId;
    const workspaceSlug = normalizeWorkspaceSlug(message?.workspaceSlug);
    const topics = normalizeTopics(message?.topics);

    if (!validateTopicsOrError(socket, requestId, topics)) {
      return;
    }
    if (!validateTopicSurfacesOrError(socket, requestId, topics)) {
      return;
    }

    const { workspaceTopics, userTopics } = partitionTopicsByScope(topics);
    if (workspaceTopics.length > 0 && !workspaceSlug) {
      emitProtocolError(socket, {
        requestId,
        code: REALTIME_ERROR_CODES.WORKSPACE_REQUIRED
      });
      return;
    }

    const subscriptions = socket?.data?.subscriptions;
    if (!(subscriptions instanceof Map)) {
      emitProtocolError(socket, {
        requestId,
        code: REALTIME_ERROR_CODES.INTERNAL_ERROR
      });
      return;
    }

    const workspaceTopicsToRemove = new Set(workspaceTopics);
    const userTopicsToRemove = new Set(userTopics);
    const socketUserId = Number(socket?.data?.user?.id);
    if (userTopicsToRemove.size > 0 && (!Number.isInteger(socketUserId) || socketUserId < 1)) {
      emitProtocolError(socket, {
        requestId,
        code: REALTIME_ERROR_CODES.UNAUTHORIZED
      });
      return;
    }

    for (const [subscriptionKey, subscription] of subscriptions.entries()) {
      const subscriptionScope = normalizeTopicScope(subscription?.scope);
      const subscriptionTopic = String(subscription?.topic || "").trim();

      if (subscriptionScope === TOPIC_SCOPES.USER) {
        const subscriptionUserId = Number(subscription?.userId);
        if (subscriptionUserId !== socketUserId || !userTopicsToRemove.has(subscriptionTopic)) {
          continue;
        }

        subscriptions.delete(subscriptionKey);
        if (Number.isInteger(subscriptionUserId) && subscriptionUserId > 0) {
          socket.leave(buildUserTopicRoomName(subscriptionUserId, subscriptionTopic));
        }
        continue;
      }

      const subscriptionWorkspaceSlug = normalizeWorkspaceSlug(subscription?.workspaceSlug);
      if (subscriptionWorkspaceSlug !== workspaceSlug || !workspaceTopicsToRemove.has(subscriptionTopic)) {
        continue;
      }

      subscriptions.delete(subscriptionKey);
      const workspaceId = Number(subscription.workspaceId);
      if (Number.isInteger(workspaceId) && workspaceId > 0) {
        socket.leave(buildWorkspaceRoomName(workspaceId, subscriptionTopic));
      }
    }

    emitMessage(
      socket,
      createAckPayload({
        type: REALTIME_MESSAGE_TYPES.UNSUBSCRIBED,
        requestId,
        workspaceSlug,
        topics
      })
    );
  }

  async function handleInboundMessage(socket, messagePayload) {
    const byteLength = getMessageByteLength(messagePayload);
    if (byteLength > maxInboundMessageBytes) {
      emitProtocolError(socket, {
        requestId: null,
        code: REALTIME_ERROR_CODES.PAYLOAD_TOO_LARGE
      });
      socket.disconnect(true);
      return;
    }

    if (!messagePayload || typeof messagePayload !== "object" || Array.isArray(messagePayload)) {
      emitProtocolError(socket, {
        requestId: null,
        code: REALTIME_ERROR_CODES.INVALID_MESSAGE
      });
      return;
    }

    const type = String(messagePayload.type || "").trim();
    if (type === REALTIME_MESSAGE_TYPES.SUBSCRIBE) {
      await handleSubscribe(socket, messagePayload);
      return;
    }

    if (type === REALTIME_MESSAGE_TYPES.UNSUBSCRIBE) {
      await handleUnsubscribe(socket, messagePayload);
      return;
    }

    if (type === REALTIME_MESSAGE_TYPES.PING) {
      emitMessage(
        socket,
        createPongPayload({
          requestId: messagePayload.requestId,
          ts: messagePayload.ts
        })
      );
      return;
    }

    emitProtocolError(socket, {
      requestId: messagePayload.requestId,
      code: REALTIME_ERROR_CODES.INVALID_MESSAGE
    });
  }

  io.use(async (socket, next) => {
    const connectionSurface = resolveConnectionSurface(socket, normalizeConnectionSurface);
    if (!connectionSurface) {
      next(createSocketMiddlewareError(REALTIME_ERROR_CODES.UNSUPPORTED_SURFACE));
      return;
    }

    const requestContext = buildSocketRequestContext(socket, path);

    let authResult;
    try {
      authResult = await authService.authenticateRequest(requestContext);
    } catch {
      next(createSocketMiddlewareError(REALTIME_ERROR_CODES.INTERNAL_ERROR));
      return;
    }

    if (authResult?.transientFailure) {
      next(createSocketMiddlewareError(REALTIME_ERROR_CODES.INTERNAL_ERROR));
      return;
    }

    if (!authResult?.authenticated || !authResult?.profile) {
      next(createSocketMiddlewareError(REALTIME_ERROR_CODES.UNAUTHORIZED));
      return;
    }

    socket.data.user = authResult.profile;
    socket.data.surface = connectionSurface;
    socket.data.requestContext = requestContext;
    socket.data.subscriptions = new Map();
    next();
  });

  io.on("connection", (socket) => {
    const socketUserId = Number(socket?.data?.user?.id);
    if (Number.isInteger(socketUserId) && socketUserId > 0) {
      socket.join(buildUserRoomName(socketUserId));
    }

    socket.on(SOCKET_IO_MESSAGE_EVENT, (messagePayload) => {
      void handleInboundMessage(socket, messagePayload).catch(() => {
        emitProtocolError(socket, {
          requestId: null,
          code: REALTIME_ERROR_CODES.INTERNAL_ERROR
        });
      });
    });

    socket.on("disconnect", () => {
      removeConnectionSubscriptions(socket);
    });
  });

  async function fanoutTargetedEvent(eventEnvelope, targetUserIds) {
    const socketById = new Map();

    try {
      await Promise.all(
        targetUserIds.map(async (targetUserId) => {
          const roomName = buildUserRoomName(targetUserId);
          const sockets = await io.in(roomName).fetchSockets();
          for (const socket of sockets) {
            socketById.set(String(socket?.id || ""), socket);
          }
        })
      );
    } catch (error) {
      appLogger.warn(
        {
          err: error,
          targetUserIds
        },
        "realtime.socketio.targeted_fanout_socket_lookup_failed"
      );
      return;
    }

    await Promise.all(
      Array.from(socketById.values()).map(async (socket) => {
        await emitEventMessage(socket, eventEnvelope);
      })
    );
  }

  async function fanoutUserScopedTargetedEvent(eventEnvelope, targetUserIds, topic) {
    const socketById = new Map();

    try {
      await Promise.all(
        targetUserIds.map(async (targetUserId) => {
          const roomName = buildUserTopicRoomName(targetUserId, topic);
          const sockets = await io.in(roomName).fetchSockets();
          for (const socket of sockets) {
            socketById.set(String(socket?.id || ""), socket);
          }
        })
      );
    } catch (error) {
      appLogger.warn(
        {
          err: error,
          topic,
          targetUserIds
        },
        "realtime.socketio.targeted_topic_fanout_socket_lookup_failed"
      );
      return;
    }

    await Promise.all(
      Array.from(socketById.values()).map(async (socket) => {
        const surfaceId = normalizeSocketSurface(socket?.data?.surface);
        const socketUserId = Number(socket?.data?.user?.id);
        if (!surfaceId || !isTopicAllowedForSurface(topic, surfaceId)) {
          if (Number.isInteger(socketUserId) && socketUserId > 0) {
            await evictUserTopicSocketSubscription(socket, {
              userId: socketUserId,
              topic
            });
          }
          return;
        }

        await emitEventMessage(socket, eventEnvelope);
      })
    );
  }

  async function fanoutEvent(eventEnvelope) {
    const topic = String(eventEnvelope?.topic || "").trim();
    let topicScope = TOPIC_SCOPES.WORKSPACE;
    try {
      topicScope = normalizeTopicScope(getTopicScope(topic));
    } catch {
      topicScope = TOPIC_SCOPES.WORKSPACE;
    }
    const targetUserIds = normalizeTargetUserIds(eventEnvelope?.targetUserIds);
    if (targetUserIds.length > 0) {
      if (topic && topicScope === TOPIC_SCOPES.USER) {
        await fanoutUserScopedTargetedEvent(eventEnvelope, targetUserIds, topic);
        return;
      }
      await fanoutTargetedEvent(eventEnvelope, targetUserIds);
      return;
    }

    const workspaceId = Number(eventEnvelope?.workspaceId);
    if (topicScope === TOPIC_SCOPES.USER) {
      appLogger.warn(
        {
          topic
        },
        "realtime.socketio.user_topic_event_missing_targets"
      );
      return;
    }

    const workspaceSlug = normalizeWorkspaceSlug(eventEnvelope?.workspaceSlug);
    if (!Number.isInteger(workspaceId) || workspaceId < 1 || !topic || !workspaceSlug) {
      if (Number.isInteger(workspaceId) && workspaceId > 0 && topic) {
        appLogger.warn(
          {
            workspaceId,
            topic
          },
          "realtime.socketio.event_missing_workspace_slug"
        );
      }
      return;
    }

    const roomName = buildWorkspaceRoomName(workspaceId, topic);
    let sockets = [];
    try {
      sockets = await io.in(roomName).fetchSockets();
    } catch (error) {
      appLogger.warn(
        {
          err: error,
          workspaceId,
          workspaceSlug,
          topic
        },
        "realtime.socketio.fanout_socket_lookup_failed"
      );
      return;
    }

    await Promise.all(
      sockets.map(async (socket) => {
        const receiveDecision = await canSocketReceiveEvent(socket, {
          workspaceId,
          workspaceSlug,
          topic
        });

        if (!receiveDecision?.allowed) {
          if (!receiveDecision?.evict) {
            return;
          }
          await evictWorkspaceSocketSubscription(socket, {
            workspaceId,
            topic
          });
          appLogger.warn(
            {
              socketId: String(socket?.id || ""),
              workspaceId,
              workspaceSlug,
              topic
            },
            "realtime.socketio.subscription_evicted"
          );
          return;
        }

        await emitEventMessage(socket, eventEnvelope);
      })
    );
  }

  const unsubscribeEventsListener = realtimeEventsService.subscribe((eventEnvelope) => {
    void fanoutEvent(eventEnvelope).catch((error) => {
      appLogger.warn(
        {
          err: error
        },
        "realtime.socketio.fanout_failed"
      );
    });
  });

  fastify.addHook("onClose", async () => {
    unsubscribeEventsListener();

    await new Promise((resolve) => {
      io.close(() => {
        resolve();
      });
    });

    if (redisClient) {
      await closeRedisClientWithTimeout(redisClient, {
        timeoutMs: redisQuitTimeoutMs
      });
    }
  });

  return io;
}

const __testables = {
  normalizeRedisQuitTimeoutMs,
  normalizeRedisConnectTimeoutMs,
  connectRedisClientWithTimeout,
  closeRedisClientWithTimeout
};

export {
  registerRealtimeServerSocketio,
  SOCKET_IO_PATH,
  SOCKET_IO_MESSAGE_EVENT,
  MAX_INBOUND_MESSAGE_BYTES,
  __testables
};
