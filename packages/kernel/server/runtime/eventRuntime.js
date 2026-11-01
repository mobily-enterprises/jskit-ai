function normalizeListener(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Event listener must be an object.");
  }
  const id = String(value.id || "").trim();
  if (!id) throw new TypeError("Event listener id is required.");
  // readable-check: allow method-probe - input validation: a registered listener must have handle()
  if (typeof value.handle !== "function") {
    throw new TypeError(`Event listener "${id}" requires handle().`);
  }
  // readable-check: allow method-probe - input validation: a registered listener's matches() is optional
  if (value.matches != null && typeof value.matches !== "function") {
    throw new TypeError(`Event listener "${id}" matches must be a function when provided.`);
  }
  return Object.freeze({
    id,
    handle: value.handle,
    matches: value.matches ?? null
  });
}

function normalizeEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Published event must be an object.");
  }
  const type = String(value.type || "").trim();
  if (!type) throw new TypeError("Published event type is required.");
  return Object.freeze({ ...value, type });
}

function createEventRuntime() {
  const listeners = [];
  const listenerIds = new Set();

  function register(value) {
    const listener = normalizeListener(value);
    if (listenerIds.has(listener.id)) {
      throw new Error(`Event listener "${listener.id}" is duplicated.`);
    }
    listenerIds.add(listener.id);
    listeners.push(listener);
    return api;
  }

  async function publish(value) {
    const event = normalizeEvent(value);
    for (const listener of listeners) {
      if (listener.matches && listener.matches(event) !== true) continue;
      await listener.handle(event);
    }
    return event;
  }

  function diagnostics() {
    return Object.freeze({
      listenerIds: Object.freeze(listeners.map((listener) => listener.id))
    });
  }

  const api = Object.freeze({ register, publish, diagnostics });
  return api;
}

export { createEventRuntime };
