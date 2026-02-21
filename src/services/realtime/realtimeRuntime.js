import { io as createSocketIoClient } from "socket.io-client";

import { REALTIME_ERROR_CODES, REALTIME_MESSAGE_TYPES } from "../../../shared/realtime/protocolTypes.js";
import { getTopicRule, listRealtimeTopicsForSurface } from "../../../shared/realtime/topicRegistry.js";
import { projectsScopeQueryKey } from "../../features/projects/queryKeys.js";
import { getClientId } from "./clientIdentity.js";
import { commandTracker } from "./commandTracker.js";
import { createRealtimeEventHandlers } from "./realtimeEventHandlers.js";

const SOCKET_IO_PATH = "/api/realtime";
const SOCKET_IO_MESSAGE_EVENT = "realtime:message";
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 10_000;
const MAINTENANCE_INTERVAL_MS = 1_000;
const MAX_REPLAY_EVENTS_PER_COMMAND = 25;
const MAX_REPLAY_EVENTS_PER_TICK = 75;

function normalizeSurface(surface) {
  return String(surface || "")
    .trim()
    .toLowerCase();
}

function resolveRuntimeFingerprint({ surface, authenticated, workspaceSlug, topics }) {
  const normalizedTopics = normalizeTopics(topics);
  return [
    normalizeSurface(surface),
    authenticated ? "1" : "0",
    workspaceSlug || "none",
    normalizedTopics.join(",") || "none"
  ].join(":");
}

function hasAnyTopicPermission({ workspaceStore, topic }) {
  const topicRule = getTopicRule(topic);
  if (!topicRule) {
    return false;
  }

  const requiredPermissions = Array.isArray(topicRule.requiredAnyPermission) ? topicRule.requiredAnyPermission : [];
  if (requiredPermissions.length < 1) {
    return true;
  }

  if (typeof workspaceStore?.can !== "function") {
    return false;
  }

  return requiredPermissions.some((permission) => workspaceStore.can(permission));
}

function resolveEligibleTopics(workspaceStore, surface) {
  return listRealtimeTopicsForSurface(surface).filter((topic) => hasAnyTopicPermission({ workspaceStore, topic }));
}

function buildRealtimeUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location?.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.host}`;
}

function resolveSocketSurface(surfaceIdValue = "") {
  const surface = String(surfaceIdValue || "")
    .trim()
    .toLowerCase();
  return surface || "app";
}

function buildRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req_${crypto.randomUUID()}`;
  }

  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTopics(topics) {
  const source = Array.isArray(topics) ? topics : [];
  return [...new Set(source.map((topic) => String(topic || "").trim()).filter(Boolean))].sort();
}

function sameTopics(left, right) {
  const normalizedLeft = normalizeTopics(left);
  const normalizedRight = normalizeTopics(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  for (let index = 0; index < normalizedLeft.length; index += 1) {
    if (normalizedLeft[index] !== normalizedRight[index]) {
      return false;
    }
  }
  return true;
}

function createRealtimeRuntime({
  authStore,
  workspaceStore,
  queryClient,
  surface,
  socketFactory = createSocketIoClient
}) {
  if (!authStore || !workspaceStore || !queryClient) {
    throw new Error("authStore, workspaceStore, and queryClient are required.");
  }

  const clientId = getClientId();
  const eventHandlers = createRealtimeEventHandlers({
    queryClient,
    commandTracker,
    clientId,
    workspaceStore
  });

  const pendingControlRequests = new Map();

  let started = false;
  let socket = null;
  let connecting = false;
  let socketEpoch = 0;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let maintenanceTimer = null;
  let finalizationUnsubscribe = null;
  let activeConnectionFingerprint = "";
  let terminalForbiddenFingerprint = "";

  function clearReconnectTimer() {
    if (!reconnectTimer) {
      return;
    }

    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function getEligibility() {
    const workspaceSlug = String(workspaceStore?.activeWorkspaceSlug || "").trim();
    const authenticated = Boolean(authStore?.isAuthenticated);
    const normalizedSurface = normalizeSurface(surface);
    const topics = resolveEligibleTopics(workspaceStore, normalizedSurface);

    return {
      authenticated,
      workspaceSlug,
      topics,
      eligible: Boolean(authenticated && workspaceSlug && topics.length > 0),
      fingerprint: resolveRuntimeFingerprint({
        surface: normalizedSurface,
        authenticated,
        workspaceSlug,
        topics
      })
    };
  }

  function clearSocket() {
    if (!socket) {
      return;
    }

    try {
      socket.removeAllListeners();
    } catch {
      // ignore teardown issues
    }

    socket = null;
    connecting = false;
    activeConnectionFingerprint = "";
  }

  function closeSocket() {
    if (!socket) {
      return;
    }

    const activeSocket = socket;
    clearSocket();

    try {
      activeSocket.disconnect();
    } catch {
      // ignore close errors
    }
  }

  async function processDeferredEventsForCommand(commandId, { maxEvents = MAX_REPLAY_EVENTS_PER_COMMAND } = {}) {
    const deferredEvents = commandTracker.drainDeferredEventsForCommand(commandId, "replay");
    if (deferredEvents.length < 1) {
      return 0;
    }

    const boundedEvents = deferredEvents.slice(0, maxEvents);
    const overflowEvents = deferredEvents.slice(maxEvents);

    await eventHandlers.processEvents(boundedEvents, {
      allowDeferral: false,
      maxEvents
    });

    for (const deferredEvent of overflowEvents) {
      commandTracker.deferSelfEvent(deferredEvent);
    }

    return boundedEvents.length;
  }

  async function processDeferredEventsForFinalizedCommands({ maxEvents = MAX_REPLAY_EVENTS_PER_TICK } = {}) {
    let replayedEvents = 0;

    for (const commandId of commandTracker.listDeferredCommandIds()) {
      if (replayedEvents >= maxEvents) {
        break;
      }

      const commandState = commandTracker.getCommandState(commandId);
      if (commandState === "acked") {
        commandTracker.dropDeferredEventsForCommand(commandId);
        continue;
      }

      if (commandState !== "failed") {
        continue;
      }

      const remainingBudget = Math.max(0, maxEvents - replayedEvents);
      replayedEvents += await processDeferredEventsForCommand(commandId, {
        maxEvents: remainingBudget
      });
    }

    return replayedEvents;
  }

  async function runMaintenanceSweep() {
    const now = Date.now();
    commandTracker.pruneExpired(now);

    const expiredPendingCommands = commandTracker.collectExpiredPendingCommands(now);
    for (const expiredCommandId of expiredPendingCommands) {
      commandTracker.markCommandFailed(expiredCommandId, "expired");
    }

    await processDeferredEventsForFinalizedCommands();
  }

  async function reconcileSubscribe(workspaceSlug, topics) {
    if (typeof eventHandlers.reconcileTopics === "function") {
      await eventHandlers.reconcileTopics({
        workspaceSlug,
        topics
      });
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: projectsScopeQueryKey(workspaceSlug)
    });
  }

  function sendControlMessage(payload, tracking = null) {
    if (!socket || socket.connected !== true) {
      return false;
    }

    try {
      socket.emit(SOCKET_IO_MESSAGE_EVENT, payload);
      if (tracking && tracking.requestId) {
        pendingControlRequests.set(String(tracking.requestId), {
          ...tracking,
          socketEpoch
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  function sendSubscribe(workspaceSlug, fingerprint, topics) {
    const requestId = buildRequestId();
    const normalizedTopics = normalizeTopics(topics);
    sendControlMessage(
      {
        type: REALTIME_MESSAGE_TYPES.SUBSCRIBE,
        requestId,
        workspaceSlug,
        topics: normalizedTopics
      },
      {
        requestId,
        type: REALTIME_MESSAGE_TYPES.SUBSCRIBE,
        workspaceSlug,
        topics: normalizedTopics,
        fingerprint
      }
    );
  }

  function scheduleReconnect(fingerprint) {
    if (!started || reconnectTimer || terminalForbiddenFingerprint === fingerprint) {
      return;
    }

    reconnectAttempts += 1;
    const baseDelay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttempts - 1));
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseDelay * 0.2)));
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, baseDelay + jitter);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void ensureConnection();
    }, delay);
  }

  async function handleControlMessage(messagePayload) {
    const type = String(messagePayload?.type || "").trim();
    const requestId = String(messagePayload?.requestId || "").trim();
    const tracking = requestId ? pendingControlRequests.get(requestId) : null;

    if (type === REALTIME_MESSAGE_TYPES.SUBSCRIBED && tracking) {
      pendingControlRequests.delete(requestId);
      if (tracking.socketEpoch !== socketEpoch) {
        return;
      }

      const eligibility = getEligibility();
      if (tracking.fingerprint !== eligibility.fingerprint) {
        return;
      }
      const ackWorkspaceSlug = String(messagePayload?.workspaceSlug || "").trim();
      if (ackWorkspaceSlug !== tracking.workspaceSlug) {
        return;
      }
      if (!sameTopics(messagePayload?.topics, tracking.topics)) {
        return;
      }

      reconnectAttempts = 0;
      await reconcileSubscribe(tracking.workspaceSlug, tracking.topics);
      return;
    }

    if (type === REALTIME_MESSAGE_TYPES.ERROR && tracking) {
      pendingControlRequests.delete(requestId);
      if (tracking.socketEpoch !== socketEpoch) {
        return;
      }

      const code = String(messagePayload?.code || "").trim();
      if (tracking.type === REALTIME_MESSAGE_TYPES.SUBSCRIBE && code === REALTIME_ERROR_CODES.FORBIDDEN) {
        terminalForbiddenFingerprint = tracking.fingerprint;
        closeSocket();
      }
      return;
    }

    if (type === REALTIME_MESSAGE_TYPES.EVENT && messagePayload?.event) {
      await eventHandlers.processEvent(messagePayload.event, {
        allowDeferral: true
      });
    }
  }

  async function ensureConnection() {
    if (!started) {
      return;
    }

    const eligibility = getEligibility();
    if (terminalForbiddenFingerprint && terminalForbiddenFingerprint !== eligibility.fingerprint) {
      terminalForbiddenFingerprint = "";
    }

    if (!eligibility.eligible || terminalForbiddenFingerprint === eligibility.fingerprint) {
      pendingControlRequests.clear();
      clearReconnectTimer();
      reconnectAttempts = 0;
      closeSocket();
      return;
    }

    if (socket && activeConnectionFingerprint === eligibility.fingerprint && (socket.connected || connecting)) {
      return;
    }

    if (socket && (socket.connected || connecting)) {
      closeSocket();
    }

    const realtimeUrl = buildRealtimeUrl();
    if (!realtimeUrl || typeof socketFactory !== "function") {
      return;
    }

    socketEpoch += 1;
    const connectionEpoch = socketEpoch;
    connecting = true;
    activeConnectionFingerprint = eligibility.fingerprint;
    const nextSocket = socketFactory(realtimeUrl, {
      path: SOCKET_IO_PATH,
      transports: ["websocket"],
      autoConnect: false,
      reconnection: false,
      query: {
        surface: resolveSocketSurface(surface)
      }
    });
    socket = nextSocket;

    nextSocket.on("connect", () => {
      if (!started || socketEpoch !== connectionEpoch) {
        return;
      }

      connecting = false;
      pendingControlRequests.clear();
      sendSubscribe(eligibility.workspaceSlug, eligibility.fingerprint, eligibility.topics);
    });

    nextSocket.on(SOCKET_IO_MESSAGE_EVENT, (payload) => {
      void handleControlMessage(payload).finally(() => {
        void runMaintenanceSweep();
      });
    });

    nextSocket.on("connect_error", () => {
      if (socketEpoch !== connectionEpoch) {
        return;
      }

      clearSocket();
      if (!started) {
        return;
      }

      scheduleReconnect(eligibility.fingerprint);
    });

    nextSocket.on("disconnect", () => {
      if (socketEpoch !== connectionEpoch) {
        return;
      }

      clearSocket();
      if (!started) {
        return;
      }

      scheduleReconnect(eligibility.fingerprint);
    });

    nextSocket.connect();
  }

  function startMaintenanceLoop() {
    if (maintenanceTimer) {
      return;
    }

    maintenanceTimer = setInterval(() => {
      void runMaintenanceSweep();
      void ensureConnection();
    }, MAINTENANCE_INTERVAL_MS);
  }

  function stopMaintenanceLoop() {
    if (!maintenanceTimer) {
      return;
    }

    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }

  function start() {
    if (started) {
      return;
    }

    started = true;
    finalizationUnsubscribe = commandTracker.subscribeFinalization(({ commandId, state }) => {
      if (state === "acked") {
        commandTracker.dropDeferredEventsForCommand(commandId);
        return;
      }

      if (state === "failed") {
        void processDeferredEventsForCommand(commandId);
      }
    });

    startMaintenanceLoop();
    void ensureConnection();
  }

  function stop() {
    if (!started) {
      return;
    }

    started = false;
    pendingControlRequests.clear();
    clearReconnectTimer();
    stopMaintenanceLoop();
    reconnectAttempts = 0;
    activeConnectionFingerprint = "";

    if (typeof finalizationUnsubscribe === "function") {
      finalizationUnsubscribe();
      finalizationUnsubscribe = null;
    }

    closeSocket();
  }

  return {
    start,
    stop
  };
}

const __testables = {
  resolveRuntimeFingerprint,
  buildRealtimeUrl
};

export { createRealtimeRuntime, __testables };
