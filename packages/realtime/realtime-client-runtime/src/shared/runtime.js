import { REALTIME_ERROR_CODES, REALTIME_MESSAGE_TYPES } from "@jskit-ai/realtime-contracts";

import { createReplayPolicy } from "./policies/replay.js";
import { createReconnectPolicy } from "./policies/reconnect.js";
import { assertRealtimeTransport, createSocketIoTransport } from "./transportContract.js";
import { normalizePositiveInteger } from "./numbers.js";

const DEFAULT_MAINTENANCE_INTERVAL_MS = 1_000;

function normalizeSurface(surfaceValue = "") {
  return String(surfaceValue || "")
    .trim()
    .toLowerCase();
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...value };
}

function canonicalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeValue(value[key])])
    );
  }

  return value;
}

function stableSerialize(value) {
  try {
    return JSON.stringify(canonicalizeValue(value));
  } catch {
    return "";
  }
}

function areValuesEqual(left, right) {
  return stableSerialize(left) === stableSerialize(right);
}

function resolveEligibilityFingerprint({ eligible, subscribePayload }) {
  const payloadHash = stableSerialize(subscribePayload);
  return `${eligible ? "1" : "0"}:${payloadHash || "none"}`;
}

function normalizeEligibility(value) {
  const source = value && typeof value === "object" ? value : {};
  const eligible = Boolean(source.eligible);
  const subscribePayload = normalizePlainObject(source.subscribePayload);
  const fingerprint =
    String(source.fingerprint || "").trim() || resolveEligibilityFingerprint({ eligible, subscribePayload });

  return {
    eligible,
    fingerprint,
    subscribePayload
  };
}

function resolveConfiguredRealtimeUrl() {
  const envObject = typeof import.meta !== "undefined" && import.meta && import.meta.env ? import.meta.env : null;
  const configured = String(envObject?.VITE_REALTIME_URL || "").trim();
  if (!configured) {
    return "";
  }

  return configured.replace(/\/+$/, "");
}

function buildRealtimeUrl() {
  const configuredRealtimeUrl = resolveConfiguredRealtimeUrl();
  if (configuredRealtimeUrl) {
    return configuredRealtimeUrl;
  }

  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location?.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.host}`;
}

function buildRequestId({ now = Date.now, random = Math.random } = {}) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req_${crypto.randomUUID()}`;
  }

  const nowValue = Number(now()) || Date.now();
  const randomValue = Math.max(0, Number(random()) || 0);
  return `req_${nowValue.toString(36)}_${randomValue.toString(36).slice(2, 10)}`;
}

function assertCommandTracker(commandTracker) {
  if (!commandTracker || typeof commandTracker !== "object") {
    throw new Error("commandTracker is required.");
  }

  const requiredMethods = [
    "drainDeferredEventsForCommand",
    "deferSelfEvent",
    "listDeferredCommandIds",
    "getCommandState",
    "dropDeferredEventsForCommand",
    "pruneExpired",
    "collectExpiredPendingCommands",
    "markCommandFailed",
    "subscribeFinalization"
  ];

  for (const methodName of requiredMethods) {
    if (typeof commandTracker[methodName] !== "function") {
      throw new Error(`commandTracker.${methodName} is required.`);
    }
  }
}

function defaultIsSubscribeAckMatch({ message, tracking }) {
  const payload = normalizePlainObject(tracking?.subscribePayload);
  const keys = Object.keys(payload);

  for (const key of keys) {
    if (!areValuesEqual(message?.[key], payload[key])) {
      return false;
    }
  }

  return true;
}

function createRealtimeRuntime(options = {}) {
  const commandTracker = options.commandTracker;
  assertCommandTracker(commandTracker);

  const resolveEligibility = options.resolveEligibility;
  if (typeof resolveEligibility !== "function") {
    throw new Error("resolveEligibility is required.");
  }

  const onEvent = options.onEvent;
  if (typeof onEvent !== "function") {
    throw new Error("onEvent is required.");
  }

  const onEvents = typeof options.onEvents === "function" ? options.onEvents : null;
  const onSubscribed = typeof options.onSubscribed === "function" ? options.onSubscribed : null;
  const onConnectionStateChange =
    typeof options.onConnectionStateChange === "function" ? options.onConnectionStateChange : null;
  const isEventDeferred = typeof options.isEventDeferred === "function" ? options.isEventDeferred : null;
  const isSubscribeAckMatch =
    typeof options.isSubscribeAckMatch === "function" ? options.isSubscribeAckMatch : defaultIsSubscribeAckMatch;

  const reconnectPolicy =
    options.reconnectPolicy && typeof options.reconnectPolicy.nextDelay === "function"
      ? options.reconnectPolicy
      : createReconnectPolicy(options.reconnectPolicy);
  const replayPolicy =
    options.replayPolicy && typeof options.replayPolicy === "object"
      ? createReplayPolicy(options.replayPolicy)
      : createReplayPolicy();

  const maintenanceIntervalMs = normalizePositiveInteger(
    options.maintenanceIntervalMs,
    DEFAULT_MAINTENANCE_INTERVAL_MS
  );

  const surface = normalizeSurface(options.surface);
  const buildRuntimeUrl = typeof options.buildRealtimeUrl === "function" ? options.buildRealtimeUrl : buildRealtimeUrl;
  const nowFn = typeof options.now === "function" ? options.now : Date.now;
  const randomFn = typeof options.random === "function" ? options.random : Math.random;

  const setTimeoutFn = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimeoutFn = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const setIntervalFn = typeof options.setInterval === "function" ? options.setInterval : setInterval;
  const clearIntervalFn = typeof options.clearInterval === "function" ? options.clearInterval : clearInterval;

  const messageTypes = {
    ...REALTIME_MESSAGE_TYPES,
    ...(options.messageTypes && typeof options.messageTypes === "object" ? options.messageTypes : {})
  };
  const errorCodes = {
    ...REALTIME_ERROR_CODES,
    ...(options.errorCodes && typeof options.errorCodes === "object" ? options.errorCodes : {})
  };

  const transport =
    options.transport && typeof options.transport === "object"
      ? options.transport
      : createSocketIoTransport({
          socketFactory: options.socketFactory,
          path: options.socketPath,
          messageEvent: options.messageEvent,
          transports: options.transports,
          query: options.query
        });
  assertRealtimeTransport(transport);

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

  function emitConnectionState(state, details = {}) {
    if (!onConnectionStateChange) {
      return;
    }

    try {
      onConnectionStateChange({
        state,
        ...details
      });
    } catch {
      // Connection state callbacks are best-effort.
    }
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) {
      return;
    }

    clearTimeoutFn(reconnectTimer);
    reconnectTimer = null;
  }

  function getEligibility() {
    return normalizeEligibility(
      resolveEligibility({
        surface
      })
    );
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

  function closeSocket(reason = "close") {
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

    emitConnectionState("disconnected", {
      reason
    });
  }

  async function dispatchEvents(events, context = {}) {
    const source = Array.isArray(events) ? events : [];
    if (source.length < 1) {
      return [];
    }

    if (onEvents) {
      return onEvents(source, context);
    }

    const processed = [];
    for (const event of source) {
      processed.push(await onEvent(event, context));
    }

    return processed;
  }

  async function dispatchSocketEvent(eventPayload, context = {}) {
    if (isEventDeferred && isEventDeferred(eventPayload, context)) {
      commandTracker.deferSelfEvent(eventPayload);
      return {
        status: "deferred"
      };
    }

    return onEvent(eventPayload, context);
  }

  async function processDeferredEventsForCommand(commandId, { maxEvents = replayPolicy.maxEventsPerCommand } = {}) {
    const deferredEvents = commandTracker.drainDeferredEventsForCommand(commandId, "replay");
    if (deferredEvents.length < 1) {
      return 0;
    }

    const boundedEvents = deferredEvents.slice(0, maxEvents);
    const overflowEvents = deferredEvents.slice(maxEvents);

    await dispatchEvents(boundedEvents, {
      allowDeferral: false,
      source: "deferred-replay",
      commandId
    });

    for (const deferredEvent of overflowEvents) {
      commandTracker.deferSelfEvent(deferredEvent);
    }

    return boundedEvents.length;
  }

  async function processDeferredEventsForFinalizedCommands({ maxEvents = replayPolicy.maxEventsPerTick } = {}) {
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
    const now = Number(nowFn()) || Date.now();
    commandTracker.pruneExpired(now);

    const expiredPendingCommands = commandTracker.collectExpiredPendingCommands(now);
    for (const expiredCommandId of expiredPendingCommands) {
      commandTracker.markCommandFailed(expiredCommandId, "expired");
    }

    await processDeferredEventsForFinalizedCommands();
  }

  function sendControlMessage(payload, tracking = null) {
    if (!socket || socket.connected !== true) {
      return false;
    }

    try {
      socket.emit(transport.messageEvent, payload);
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

  function sendSubscribe(eligibility) {
    const requestId = buildRequestId({ now: nowFn, random: randomFn });
    const subscribePayload = normalizePlainObject(eligibility?.subscribePayload);

    sendControlMessage(
      {
        type: messageTypes.SUBSCRIBE,
        requestId,
        ...subscribePayload
      },
      {
        requestId,
        type: messageTypes.SUBSCRIBE,
        subscribePayload,
        fingerprint: String(eligibility?.fingerprint || "")
      }
    );
  }

  function scheduleReconnect(fingerprint) {
    if (!started || reconnectTimer || terminalForbiddenFingerprint === fingerprint) {
      return;
    }

    reconnectAttempts += 1;
    const delay = reconnectPolicy.nextDelay(reconnectAttempts);

    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      void ensureConnection();
    }, delay);

    emitConnectionState("reconnect_scheduled", {
      fingerprint,
      attempt: reconnectAttempts,
      delayMs: delay
    });
  }

  async function handleControlMessage(messagePayload) {
    const type = String(messagePayload?.type || "").trim();
    const requestId = String(messagePayload?.requestId || "").trim();
    const tracking = requestId ? pendingControlRequests.get(requestId) : null;

    if (type === messageTypes.SUBSCRIBED && tracking) {
      pendingControlRequests.delete(requestId);
      if (tracking.socketEpoch !== socketEpoch) {
        return;
      }

      const eligibility = getEligibility();
      if (tracking.fingerprint !== eligibility.fingerprint) {
        return;
      }

      if (!isSubscribeAckMatch({ message: messagePayload, tracking, eligibility })) {
        return;
      }

      reconnectAttempts = 0;
      emitConnectionState("subscribed", {
        fingerprint: tracking.fingerprint,
        subscribePayload: tracking.subscribePayload
      });

      if (onSubscribed) {
        await onSubscribed({
          message: messagePayload,
          tracking,
          eligibility,
          subscribePayload: tracking.subscribePayload
        });
      }
      return;
    }

    if (type === messageTypes.ERROR && tracking) {
      pendingControlRequests.delete(requestId);
      if (tracking.socketEpoch !== socketEpoch) {
        return;
      }

      const code = String(messagePayload?.code || "").trim();
      if (tracking.type === messageTypes.SUBSCRIBE && code === errorCodes.FORBIDDEN) {
        terminalForbiddenFingerprint = tracking.fingerprint;
        emitConnectionState("forbidden", {
          fingerprint: tracking.fingerprint,
          requestId,
          code
        });
        closeSocket("forbidden");
      }
      return;
    }

    if (type === messageTypes.EVENT && messagePayload?.event) {
      await dispatchSocketEvent(messagePayload.event, {
        allowDeferral: true,
        source: "socket"
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
      closeSocket("ineligible");
      emitConnectionState("idle", {
        fingerprint: eligibility.fingerprint,
        eligible: eligibility.eligible
      });
      return;
    }

    if (socket && activeConnectionFingerprint === eligibility.fingerprint && (socket.connected || connecting)) {
      return;
    }

    if (socket && (socket.connected || connecting)) {
      closeSocket("fingerprint_changed");
    }

    const realtimeUrl = String(buildRuntimeUrl({ surface }) || "").trim();
    if (!realtimeUrl) {
      emitConnectionState("idle", {
        reason: "no_realtime_url"
      });
      return;
    }

    socketEpoch += 1;
    const connectionEpoch = socketEpoch;
    connecting = true;
    activeConnectionFingerprint = eligibility.fingerprint;

    emitConnectionState("connecting", {
      fingerprint: eligibility.fingerprint,
      realtimeUrl
    });

    const nextSocket = transport.createConnection({
      url: realtimeUrl,
      surface
    });

    if (!nextSocket || typeof nextSocket.on !== "function" || typeof nextSocket.connect !== "function") {
      throw new Error("transport.createConnection must return a socket-like object.");
    }

    socket = nextSocket;

    nextSocket.on("connect", () => {
      if (!started || socketEpoch !== connectionEpoch) {
        return;
      }

      connecting = false;
      pendingControlRequests.clear();
      emitConnectionState("connected", {
        fingerprint: eligibility.fingerprint
      });
      sendSubscribe(eligibility);
    });

    nextSocket.on(transport.messageEvent, (payload) => {
      void handleControlMessage(payload).finally(() => {
        void runMaintenanceSweep();
      });
    });

    nextSocket.on("connect_error", () => {
      if (socketEpoch !== connectionEpoch) {
        return;
      }

      clearSocket();
      emitConnectionState("connect_error", {
        fingerprint: eligibility.fingerprint
      });

      if (!started) {
        return;
      }

      scheduleReconnect(eligibility.fingerprint);
    });

    nextSocket.on("disconnect", (reason) => {
      if (socketEpoch !== connectionEpoch) {
        return;
      }

      clearSocket();
      emitConnectionState("disconnected", {
        fingerprint: eligibility.fingerprint,
        reason
      });

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

    maintenanceTimer = setIntervalFn(() => {
      void runMaintenanceSweep();
      void ensureConnection();
    }, maintenanceIntervalMs);
  }

  function stopMaintenanceLoop() {
    if (!maintenanceTimer) {
      return;
    }

    clearIntervalFn(maintenanceTimer);
    maintenanceTimer = null;
  }

  function start() {
    if (started) {
      return;
    }

    started = true;
    emitConnectionState("started", {
      surface
    });

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

    closeSocket("stopped");
    emitConnectionState("stopped", {
      surface
    });
  }

  return {
    start,
    stop
  };
}

const __testables = {
  resolveConfiguredRealtimeUrl,
  buildRealtimeUrl,
  resolveEligibilityFingerprint,
  defaultIsSubscribeAckMatch
};

export { createRealtimeRuntime, __testables };
