import { REALTIME_ERROR_CODES, REALTIME_MESSAGE_TYPES } from "../../shared/realtime/protocolTypes.js";
import { hasTopicPermission, isSupportedTopic } from "../../shared/realtime/topicRegistry.js";
import { buildSubscribeContextRequest, normalizeWorkspaceSlug } from "./realtime/subscribeContext.js";

const MAX_INBOUND_MESSAGE_BYTES = 8192;
const HEARTBEAT_INTERVAL_MS = 30_000;

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

function getMessageByteLength(rawMessage) {
  if (Buffer.isBuffer(rawMessage)) {
    return rawMessage.length;
  }

  return Buffer.byteLength(String(rawMessage || ""), "utf8");
}

function toMessageText(rawMessage) {
  if (typeof rawMessage === "string") {
    return rawMessage;
  }

  if (Buffer.isBuffer(rawMessage)) {
    return rawMessage.toString("utf8");
  }

  return String(rawMessage || "");
}

function buildSubscriptionKey(workspaceId, topic) {
  return `${Number(workspaceId)}:${String(topic || "").trim()}`;
}

function safeCloseSocket(socket, code = 1000, reason = "") {
  try {
    socket.close(code, reason);
  } catch {
    // ignore close errors
  }
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

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== 1) {
    return false;
  }

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
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
  if (code === REALTIME_ERROR_CODES.PAYLOAD_TOO_LARGE) {
    return "Payload too large.";
  }
  if (code === REALTIME_ERROR_CODES.INVALID_MESSAGE) {
    return "Invalid realtime message.";
  }

  return "Internal server error.";
}

function registerRealtimeRoutes(fastify, { realtimeEventsService, workspaceService }) {
  if (!realtimeEventsService || typeof realtimeEventsService.subscribe !== "function") {
    throw new Error("realtimeEventsService is required.");
  }
  if (!workspaceService || typeof workspaceService.resolveRequestContext !== "function") {
    throw new Error("workspaceService is required.");
  }

  const activeConnections = new Set();
  const subscriptionsByKey = new Map();

  function removeConnectionSubscriptions(connectionState) {
    for (const subscriptionKey of connectionState.subscriptions.keys()) {
      const subscribers = subscriptionsByKey.get(subscriptionKey);
      if (!subscribers) {
        continue;
      }

      subscribers.delete(connectionState);
      if (subscribers.size < 1) {
        subscriptionsByKey.delete(subscriptionKey);
      }
    }

    connectionState.subscriptions.clear();
  }

  function cleanupConnection(connectionState) {
    if (!connectionState || connectionState.closed) {
      return;
    }

    connectionState.closed = true;
    removeConnectionSubscriptions(connectionState);
    activeConnections.delete(connectionState);
  }

  function sendProtocolError(connectionState, { requestId, code }) {
    return sendJson(
      connectionState.socket,
      createProtocolErrorPayload({
        requestId,
        code,
        message: buildProtocolErrorMessage(code)
      })
    );
  }

  function rejectOversizedMessage(connectionState) {
    sendProtocolError(connectionState, {
      requestId: null,
      code: REALTIME_ERROR_CODES.PAYLOAD_TOO_LARGE
    });
    safeCloseSocket(connectionState.socket, 1009, "Message too large");
    cleanupConnection(connectionState);
  }

  function normalizeWorkspaceAndTopics(message) {
    const workspaceSlug = normalizeWorkspaceSlug(message?.workspaceSlug);
    const topics = normalizeTopics(message?.topics);
    return {
      workspaceSlug,
      topics
    };
  }

  function validateTopicsOrError(connectionState, requestId, topics) {
    if (!Array.isArray(topics) || topics.length < 1) {
      sendProtocolError(connectionState, {
        requestId,
        code: REALTIME_ERROR_CODES.INVALID_MESSAGE
      });
      return false;
    }

    for (const topic of topics) {
      if (!isSupportedTopic(topic)) {
        sendProtocolError(connectionState, {
          requestId,
          code: REALTIME_ERROR_CODES.UNSUPPORTED_TOPIC
        });
        return false;
      }
    }

    return true;
  }

  function validateTopicPermissionsOrError(connectionState, requestId, topics, permissions) {
    for (const topic of topics) {
      if (!hasTopicPermission(topic, permissions)) {
        sendProtocolError(connectionState, {
          requestId,
          code: REALTIME_ERROR_CODES.FORBIDDEN
        });
        return false;
      }
    }

    return true;
  }

  async function resolveSubscribeAuthorization(request, workspaceSlug) {
    const subscribeRequest = buildSubscribeContextRequest(request, workspaceSlug);
    const context = await workspaceService.resolveRequestContext({
      user: request.user,
      request: subscribeRequest,
      workspacePolicy: "required",
      workspaceSurface: "admin"
    });

    if (!context?.workspace) {
      return null;
    }

    return context;
  }

  async function handleSubscribe(connectionState, request, message) {
    const requestId = message?.requestId;
    const { workspaceSlug, topics } = normalizeWorkspaceAndTopics(message);

    if (!workspaceSlug) {
      sendProtocolError(connectionState, {
        requestId,
        code: REALTIME_ERROR_CODES.WORKSPACE_REQUIRED
      });
      return;
    }

    if (!validateTopicsOrError(connectionState, requestId, topics)) {
      return;
    }

    let resolvedContext;
    try {
      resolvedContext = await resolveSubscribeAuthorization(request, workspaceSlug);
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status);
      if (statusCode === 401) {
        sendProtocolError(connectionState, {
          requestId,
          code: REALTIME_ERROR_CODES.UNAUTHORIZED
        });
        return;
      }
      if (statusCode === 403 || statusCode === 409) {
        sendProtocolError(connectionState, {
          requestId,
          code: REALTIME_ERROR_CODES.FORBIDDEN
        });
        return;
      }

      sendProtocolError(connectionState, {
        requestId,
        code: REALTIME_ERROR_CODES.INTERNAL_ERROR
      });
      return;
    }

    if (!resolvedContext) {
      sendProtocolError(connectionState, {
        requestId,
        code: REALTIME_ERROR_CODES.FORBIDDEN
      });
      return;
    }
    if (!validateTopicPermissionsOrError(connectionState, requestId, topics, resolvedContext.permissions)) {
      return;
    }

    const workspaceId = Number(resolvedContext.workspace.id);
    for (const topic of topics) {
      const subscriptionKey = buildSubscriptionKey(workspaceId, topic);
      if (!connectionState.subscriptions.has(subscriptionKey)) {
        connectionState.subscriptions.set(subscriptionKey, {
          workspaceId,
          workspaceSlug,
          topic
        });
      }

      let subscribers = subscriptionsByKey.get(subscriptionKey);
      if (!subscribers) {
        subscribers = new Set();
        subscriptionsByKey.set(subscriptionKey, subscribers);
      }
      subscribers.add(connectionState);
    }

    sendJson(
      connectionState.socket,
      createAckPayload({
        type: REALTIME_MESSAGE_TYPES.SUBSCRIBED,
        requestId,
        workspaceSlug,
        topics
      })
    );
  }

  async function handleUnsubscribe(connectionState, request, message) {
    const requestId = message?.requestId;
    const { workspaceSlug, topics } = normalizeWorkspaceAndTopics(message);

    if (!workspaceSlug) {
      sendProtocolError(connectionState, {
        requestId,
        code: REALTIME_ERROR_CODES.WORKSPACE_REQUIRED
      });
      return;
    }

    if (!validateTopicsOrError(connectionState, requestId, topics)) {
      return;
    }

    let resolvedContext;
    try {
      resolvedContext = await resolveSubscribeAuthorization(request, workspaceSlug);
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status);
      if (statusCode === 401) {
        sendProtocolError(connectionState, {
          requestId,
          code: REALTIME_ERROR_CODES.UNAUTHORIZED
        });
        return;
      }
      if (statusCode === 403 || statusCode === 409) {
        sendProtocolError(connectionState, {
          requestId,
          code: REALTIME_ERROR_CODES.FORBIDDEN
        });
        return;
      }

      sendProtocolError(connectionState, {
        requestId,
        code: REALTIME_ERROR_CODES.INTERNAL_ERROR
      });
      return;
    }

    if (!resolvedContext) {
      sendProtocolError(connectionState, {
        requestId,
        code: REALTIME_ERROR_CODES.FORBIDDEN
      });
      return;
    }
    if (!validateTopicPermissionsOrError(connectionState, requestId, topics, resolvedContext.permissions)) {
      return;
    }

    const workspaceId = Number(resolvedContext.workspace.id);
    for (const topic of topics) {
      const subscriptionKey = buildSubscriptionKey(workspaceId, topic);

      connectionState.subscriptions.delete(subscriptionKey);
      const subscribers = subscriptionsByKey.get(subscriptionKey);
      if (!subscribers) {
        continue;
      }

      subscribers.delete(connectionState);
      if (subscribers.size < 1) {
        subscriptionsByKey.delete(subscriptionKey);
      }
    }

    sendJson(
      connectionState.socket,
      createAckPayload({
        type: REALTIME_MESSAGE_TYPES.UNSUBSCRIBED,
        requestId,
        workspaceSlug,
        topics
      })
    );
  }

  function handlePing(connectionState, message) {
    sendJson(
      connectionState.socket,
      createPongPayload({
        requestId: message?.requestId,
        ts: message?.ts
      })
    );
  }

  async function handleInboundMessage(connectionState, request, rawMessage, isBinary) {
    if (isBinary) {
      sendProtocolError(connectionState, {
        requestId: null,
        code: REALTIME_ERROR_CODES.INVALID_MESSAGE
      });
      safeCloseSocket(connectionState.socket, 1003, "Binary frames are not supported");
      cleanupConnection(connectionState);
      return;
    }

    const byteLength = getMessageByteLength(rawMessage);
    if (byteLength > MAX_INBOUND_MESSAGE_BYTES) {
      rejectOversizedMessage(connectionState);
      return;
    }

    let message;
    try {
      message = JSON.parse(toMessageText(rawMessage));
    } catch {
      sendProtocolError(connectionState, {
        requestId: null,
        code: REALTIME_ERROR_CODES.INVALID_MESSAGE
      });
      return;
    }

    if (!message || typeof message !== "object") {
      sendProtocolError(connectionState, {
        requestId: null,
        code: REALTIME_ERROR_CODES.INVALID_MESSAGE
      });
      return;
    }

    const type = String(message.type || "").trim();
    if (type === REALTIME_MESSAGE_TYPES.SUBSCRIBE) {
      await handleSubscribe(connectionState, request, message);
      return;
    }

    if (type === REALTIME_MESSAGE_TYPES.UNSUBSCRIBE) {
      await handleUnsubscribe(connectionState, request, message);
      return;
    }

    if (type === REALTIME_MESSAGE_TYPES.PING) {
      handlePing(connectionState, message);
      return;
    }

    sendProtocolError(connectionState, {
      requestId: message?.requestId,
      code: REALTIME_ERROR_CODES.INVALID_MESSAGE
    });
  }

  function fanoutEvent(eventEnvelope) {
    const workspaceId = Number(eventEnvelope?.workspaceId);
    const topic = String(eventEnvelope?.topic || "").trim();
    if (!Number.isInteger(workspaceId) || workspaceId < 1 || !topic) {
      return;
    }

    const subscriptionKey = buildSubscriptionKey(workspaceId, topic);
    const subscribers = subscriptionsByKey.get(subscriptionKey);
    if (!subscribers || subscribers.size < 1) {
      return;
    }

    const payload = {
      type: REALTIME_MESSAGE_TYPES.EVENT,
      event: eventEnvelope
    };

    for (const connectionState of [...subscribers]) {
      const delivered = sendJson(connectionState.socket, payload);
      if (!delivered) {
        cleanupConnection(connectionState);
      }
    }
  }

  const unsubscribeEventsListener = realtimeEventsService.subscribe((eventEnvelope) => {
    fanoutEvent(eventEnvelope);
  });

  const heartbeatTimer = setInterval(() => {
    for (const connectionState of [...activeConnections]) {
      const socket = connectionState.socket;
      if (!socket || socket.readyState !== 1) {
        cleanupConnection(connectionState);
        continue;
      }

      if (!connectionState.isAlive) {
        safeCloseSocket(socket, 1001, "Heartbeat timeout");
        cleanupConnection(connectionState);
        continue;
      }

      connectionState.isAlive = false;
      try {
        socket.ping();
      } catch {
        cleanupConnection(connectionState);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  heartbeatTimer.unref?.();

  fastify.route({
    method: "GET",
    url: "/api/realtime",
    websocket: true,
    config: {
      authPolicy: "required",
      workspacePolicy: "none",
      csrfProtection: false
    },
    handler(socket, request) {
      const connectionState = {
        socket,
        subscriptions: new Map(),
        isAlive: true,
        closed: false
      };

      activeConnections.add(connectionState);

      socket.on("pong", () => {
        connectionState.isAlive = true;
      });

      socket.on("message", (rawMessage, isBinary) => {
        void handleInboundMessage(connectionState, request, rawMessage, isBinary).catch(() => {
          sendProtocolError(connectionState, {
            requestId: null,
            code: REALTIME_ERROR_CODES.INTERNAL_ERROR
          });
        });
      });

      socket.on("close", () => {
        cleanupConnection(connectionState);
      });

      socket.on("error", () => {
        cleanupConnection(connectionState);
      });
    }
  });

  fastify.addHook("onClose", async () => {
    clearInterval(heartbeatTimer);
    unsubscribeEventsListener();

    for (const connectionState of [...activeConnections]) {
      safeCloseSocket(connectionState.socket, 1001, "Server shutting down");
      cleanupConnection(connectionState);
    }

    subscriptionsByKey.clear();
  });
}

export { registerRealtimeRoutes, MAX_INBOUND_MESSAGE_BYTES };
