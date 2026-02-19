const COMMAND_TTL_MS = 30_000;
const FINALIZED_TTL_MS = 60_000;
const SEEN_EVENT_TTL_MS = 120_000;
const DEFERRED_EVENT_TTL_MS = 60_000;
const MAX_COMMAND_ENTRIES = 1000;
const MAX_SEEN_EVENTS = 4000;
const MAX_DEFERRED_COMMANDS = 500;
const MAX_DEFERRED_EVENTS_PER_COMMAND = 25;
const MAX_DEFERRED_EVENTS_TOTAL = 2000;

const pendingCommandIds = new Map();
const ackedCommandIds = new Map();
const failedCommandIds = new Map();
const seenEventIds = new Map();
const deferredSelfEventsByCommandId = new Map();

const finalizationListeners = new Set();

function normalizeId(value) {
  return String(value || "").trim();
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

function nowMs() {
  return Date.now();
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
    expiresAt: createdAt + COMMAND_TTL_MS,
    meta: meta && typeof meta === "object" ? { ...meta } : null
  });
  trimOldestEntries(pendingCommandIds, MAX_COMMAND_ENTRIES);
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
    expiresAt: ackedAt + FINALIZED_TTL_MS
  });
  trimOldestEntries(ackedCommandIds, MAX_COMMAND_ENTRIES);
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
    expiresAt: failedAt + FINALIZED_TTL_MS,
    reason: String(reason || "").trim() || null
  });
  trimOldestEntries(failedCommandIds, MAX_COMMAND_ENTRIES);
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
  while (deferredSelfEventsByCommandId.size > MAX_DEFERRED_COMMANDS) {
    const oldestKey = deferredSelfEventsByCommandId.keys().next().value;
    if (!oldestKey) {
      break;
    }
    deferredSelfEventsByCommandId.delete(oldestKey);
  }

  while (countDeferredEvents() > MAX_DEFERRED_EVENTS_TOTAL) {
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

  return `anon_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
      expiresAt: now + DEFERRED_EVENT_TTL_MS,
      events: new Map()
    };
    deferredSelfEventsByCommandId.set(commandId, entry);
  }

  if (entry.events.has(key)) {
    return false;
  }

  entry.expiresAt = now + DEFERRED_EVENT_TTL_MS;
  entry.events.set(key, {
    ...event
  });

  while (entry.events.size > MAX_DEFERRED_EVENTS_PER_COMMAND) {
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

  seenEventIds.set(eventId, nowMs() + SEEN_EVENT_TTL_MS);
  trimOldestEntries(seenEventIds, MAX_SEEN_EVENTS);
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

const commandTracker = {
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

const __testables = {
  pendingCommandIds,
  ackedCommandIds,
  failedCommandIds,
  seenEventIds,
  deferredSelfEventsByCommandId,
  MAX_DEFERRED_EVENTS_PER_COMMAND,
  MAX_DEFERRED_EVENTS_TOTAL
};

export { commandTracker, __testables };
