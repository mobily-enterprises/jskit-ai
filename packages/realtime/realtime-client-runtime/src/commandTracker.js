const DEFAULT_COMMAND_TRACKER_OPTIONS = Object.freeze({
  commandTtlMs: 30_000,
  finalizedTtlMs: 60_000,
  seenEventTtlMs: 120_000,
  deferredEventTtlMs: 60_000,
  maxCommandEntries: 1000,
  maxSeenEvents: 4000,
  maxDeferredCommands: 500,
  maxDeferredEventsPerCommand: 25,
  maxDeferredEventsTotal: 2000
});

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }

  return Math.floor(numeric);
}

function normalizeId(value) {
  return String(value || "").trim();
}

function resolveNow(nowFn) {
  const value = Number(nowFn());
  if (!Number.isFinite(value)) {
    return Date.now();
  }
  return value;
}

function trimOldestEntries(map, maxSize) {
  while (map.size > maxSize) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) {
      break;
    }
    map.delete(oldestKey);
  }
}

function createCommandTracker(options = {}) {
  const normalizedOptions = {
    commandTtlMs: normalizePositiveInteger(options.commandTtlMs, DEFAULT_COMMAND_TRACKER_OPTIONS.commandTtlMs),
    finalizedTtlMs: normalizePositiveInteger(options.finalizedTtlMs, DEFAULT_COMMAND_TRACKER_OPTIONS.finalizedTtlMs),
    seenEventTtlMs: normalizePositiveInteger(options.seenEventTtlMs, DEFAULT_COMMAND_TRACKER_OPTIONS.seenEventTtlMs),
    deferredEventTtlMs: normalizePositiveInteger(
      options.deferredEventTtlMs,
      DEFAULT_COMMAND_TRACKER_OPTIONS.deferredEventTtlMs
    ),
    maxCommandEntries: normalizePositiveInteger(
      options.maxCommandEntries,
      DEFAULT_COMMAND_TRACKER_OPTIONS.maxCommandEntries
    ),
    maxSeenEvents: normalizePositiveInteger(options.maxSeenEvents, DEFAULT_COMMAND_TRACKER_OPTIONS.maxSeenEvents),
    maxDeferredCommands: normalizePositiveInteger(
      options.maxDeferredCommands,
      DEFAULT_COMMAND_TRACKER_OPTIONS.maxDeferredCommands
    ),
    maxDeferredEventsPerCommand: normalizePositiveInteger(
      options.maxDeferredEventsPerCommand,
      DEFAULT_COMMAND_TRACKER_OPTIONS.maxDeferredEventsPerCommand
    ),
    maxDeferredEventsTotal: normalizePositiveInteger(
      options.maxDeferredEventsTotal,
      DEFAULT_COMMAND_TRACKER_OPTIONS.maxDeferredEventsTotal
    )
  };

  const nowFn = typeof options.now === "function" ? options.now : Date.now;
  const randomFn = typeof options.random === "function" ? options.random : Math.random;

  const pendingCommandIds = new Map();
  const ackedCommandIds = new Map();
  const failedCommandIds = new Map();
  const seenEventIds = new Map();
  const deferredSelfEventsByCommandId = new Map();
  const finalizationListeners = new Set();

  function nowMs() {
    return resolveNow(nowFn);
  }

  function getCommandState(commandIdValue) {
    const commandId = normalizeId(commandIdValue);
    if (!commandId) {
      return "unknown";
    }

    if (pendingCommandIds.has(commandId)) {
      return "pending";
    }
    if (ackedCommandIds.has(commandId)) {
      return "acked";
    }
    if (failedCommandIds.has(commandId)) {
      return "failed";
    }

    return "unknown";
  }

  function markCommandPending(commandIdValue, meta = null) {
    const commandId = normalizeId(commandIdValue);
    if (!commandId) {
      return false;
    }

    const state = getCommandState(commandId);
    if (state === "pending" || state === "acked" || state === "failed") {
      return false;
    }

    const createdAt = nowMs();
    pendingCommandIds.set(commandId, {
      createdAt,
      expiresAt: createdAt + normalizedOptions.commandTtlMs,
      meta: meta && typeof meta === "object" ? { ...meta } : null
    });
    trimOldestEntries(pendingCommandIds, normalizedOptions.maxCommandEntries);
    return true;
  }

  function emitFinalization(commandId, state) {
    for (const listener of finalizationListeners) {
      try {
        listener({ commandId, state });
      } catch {
        // Listener failures must never break tracker transitions.
      }
    }
  }

  function markCommandAcked(commandIdValue) {
    const commandId = normalizeId(commandIdValue);
    if (!commandId || !pendingCommandIds.has(commandId)) {
      return false;
    }

    pendingCommandIds.delete(commandId);
    const ackedAt = nowMs();
    ackedCommandIds.set(commandId, {
      ackedAt,
      expiresAt: ackedAt + normalizedOptions.finalizedTtlMs
    });
    trimOldestEntries(ackedCommandIds, normalizedOptions.maxCommandEntries);
    emitFinalization(commandId, "acked");
    return true;
  }

  function markCommandFailed(commandIdValue, reason = "") {
    const commandId = normalizeId(commandIdValue);
    if (!commandId || !pendingCommandIds.has(commandId)) {
      return false;
    }

    pendingCommandIds.delete(commandId);
    const failedAt = nowMs();
    failedCommandIds.set(commandId, {
      failedAt,
      expiresAt: failedAt + normalizedOptions.finalizedTtlMs,
      reason: String(reason || "").trim() || null
    });
    trimOldestEntries(failedCommandIds, normalizedOptions.maxCommandEntries);
    emitFinalization(commandId, "failed");
    return true;
  }

  function isKnownLocalCommand(commandIdValue) {
    const state = getCommandState(commandIdValue);
    return state === "pending" || state === "acked";
  }

  function countDeferredEvents() {
    let total = 0;
    for (const entry of deferredSelfEventsByCommandId.values()) {
      total += entry.events.size;
    }
    return total;
  }

  function trimDeferredEntries() {
    while (deferredSelfEventsByCommandId.size > normalizedOptions.maxDeferredCommands) {
      const oldestKey = deferredSelfEventsByCommandId.keys().next().value;
      if (!oldestKey) {
        break;
      }
      deferredSelfEventsByCommandId.delete(oldestKey);
    }

    while (countDeferredEvents() > normalizedOptions.maxDeferredEventsTotal) {
      const oldestCommandId = deferredSelfEventsByCommandId.keys().next().value;
      if (!oldestCommandId) {
        break;
      }

      const entry = deferredSelfEventsByCommandId.get(oldestCommandId);
      if (!entry) {
        deferredSelfEventsByCommandId.delete(oldestCommandId);
        continue;
      }

      const oldestEventKey = entry.events.keys().next().value;
      if (!oldestEventKey) {
        deferredSelfEventsByCommandId.delete(oldestCommandId);
        continue;
      }

      entry.events.delete(oldestEventKey);
      if (entry.events.size < 1) {
        deferredSelfEventsByCommandId.delete(oldestCommandId);
      }
    }
  }

  function normalizeDeferredEventKey(event) {
    const eventId = normalizeId(event?.eventId);
    if (eventId) {
      return eventId;
    }

    return `anon_${nowMs().toString(36)}_${Math.abs(Number(randomFn() || 0)).toString(36).slice(2, 8)}`;
  }

  function deferSelfEvent(event) {
    const commandId = normalizeId(event?.commandId);
    if (!commandId || !event || typeof event !== "object") {
      return false;
    }

    const key = normalizeDeferredEventKey(event);
    const now = nowMs();

    let entry = deferredSelfEventsByCommandId.get(commandId);
    if (!entry) {
      entry = {
        expiresAt: now + normalizedOptions.deferredEventTtlMs,
        events: new Map()
      };
      deferredSelfEventsByCommandId.set(commandId, entry);
    }

    if (entry.events.has(key)) {
      return false;
    }

    entry.expiresAt = now + normalizedOptions.deferredEventTtlMs;
    entry.events.set(key, {
      ...event
    });

    while (entry.events.size > normalizedOptions.maxDeferredEventsPerCommand) {
      const oldestEventKey = entry.events.keys().next().value;
      if (!oldestEventKey) {
        break;
      }
      entry.events.delete(oldestEventKey);
    }

    trimDeferredEntries();
    return true;
  }

  function drainDeferredEventsForCommand(commandIdValue, reason = "") {
    void reason;
    const commandId = normalizeId(commandIdValue);
    if (!commandId) {
      return [];
    }

    const entry = deferredSelfEventsByCommandId.get(commandId);
    deferredSelfEventsByCommandId.delete(commandId);
    if (!entry) {
      return [];
    }

    return [...entry.events.values()];
  }

  function dropDeferredEventsForCommand(commandIdValue) {
    const commandId = normalizeId(commandIdValue);
    if (!commandId) {
      return false;
    }

    return deferredSelfEventsByCommandId.delete(commandId);
  }

  function markEventSeenAndCheckDuplicate(eventIdValue) {
    const eventId = normalizeId(eventIdValue);
    if (!eventId) {
      return false;
    }

    if (seenEventIds.has(eventId)) {
      return true;
    }

    seenEventIds.set(eventId, nowMs() + normalizedOptions.seenEventTtlMs);
    trimOldestEntries(seenEventIds, normalizedOptions.maxSeenEvents);
    return false;
  }

  function pruneExpired(now = nowMs()) {
    for (const [commandId, entry] of ackedCommandIds) {
      if (Number(entry?.expiresAt) <= now) {
        ackedCommandIds.delete(commandId);
      }
    }

    for (const [commandId, entry] of failedCommandIds) {
      if (Number(entry?.expiresAt) <= now) {
        failedCommandIds.delete(commandId);
      }
    }

    for (const [eventId, expiresAt] of seenEventIds) {
      if (Number(expiresAt) <= now) {
        seenEventIds.delete(eventId);
      }
    }

    for (const [commandId, entry] of deferredSelfEventsByCommandId) {
      if (!entry || Number(entry.expiresAt) <= now || entry.events.size < 1) {
        deferredSelfEventsByCommandId.delete(commandId);
      }
    }
  }

  function collectExpiredPendingCommands(now = nowMs()) {
    const expiredCommandIds = [];

    for (const [commandId, entry] of pendingCommandIds) {
      if (Number(entry?.expiresAt) <= now) {
        expiredCommandIds.push(commandId);
      }
    }

    return expiredCommandIds;
  }

  function subscribeFinalization(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }

    finalizationListeners.add(listener);
    return () => {
      finalizationListeners.delete(listener);
    };
  }

  function listDeferredCommandIds() {
    return [...deferredSelfEventsByCommandId.keys()];
  }

  function resetForTests() {
    pendingCommandIds.clear();
    ackedCommandIds.clear();
    failedCommandIds.clear();
    seenEventIds.clear();
    deferredSelfEventsByCommandId.clear();
    finalizationListeners.clear();
  }

  const tracker = {
    markCommandPending,
    markCommandAcked,
    markCommandFailed,
    getCommandState,
    isKnownLocalCommand,
    deferSelfEvent,
    drainDeferredEventsForCommand,
    dropDeferredEventsForCommand,
    markEventSeenAndCheckDuplicate,
    pruneExpired,
    collectExpiredPendingCommands,
    subscribeFinalization,
    listDeferredCommandIds,
    resetForTests
  };

  const testables = {
    pendingCommandIds,
    ackedCommandIds,
    failedCommandIds,
    seenEventIds,
    deferredSelfEventsByCommandId,
    MAX_DEFERRED_EVENTS_PER_COMMAND: normalizedOptions.maxDeferredEventsPerCommand,
    MAX_DEFERRED_EVENTS_TOTAL: normalizedOptions.maxDeferredEventsTotal
  };

  Object.defineProperty(tracker, "__testables", {
    value: testables,
    writable: false,
    enumerable: false,
    configurable: false
  });

  return tracker;
}

export { createCommandTracker, DEFAULT_COMMAND_TRACKER_OPTIONS };
