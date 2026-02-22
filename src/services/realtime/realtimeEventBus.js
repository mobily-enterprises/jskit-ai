const listeners = new Set();

function normalizeEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  return {
    ...event,
    payload: event.payload && typeof event.payload === "object" ? { ...event.payload } : {}
  };
}

function publishRealtimeEvent(event) {
  const normalized = normalizeEvent(event);
  if (!normalized) {
    return false;
  }

  for (const listener of listeners) {
    try {
      listener(normalized);
    } catch {
      // Listener failures should not block others.
    }
  }

  return true;
}

function subscribeRealtimeEvents(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const __testables = {
  listeners
};

export { publishRealtimeEvent, subscribeRealtimeEvents, __testables };
