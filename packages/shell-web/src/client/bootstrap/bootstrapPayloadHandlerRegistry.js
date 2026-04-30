const BOOTSTRAP_PAYLOAD_HANDLER_TAG = "runtime.web-bootstrap.handlers.client";

function assertTaggableApp(app, context = "bootstrap payload handler registry") {
  if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
    throw new Error(`${context} requires application singleton()/tag().`);
  }
}

function registerBootstrapPayloadHandler(app, token, factory) {
  assertTaggableApp(app, "registerBootstrapPayloadHandler");
  app.singleton(token, factory);
  app.tag(token, BOOTSTRAP_PAYLOAD_HANDLER_TAG);
}

function normalizeBootstrapPayloadHandler(entry) {
  if (typeof entry === "function") {
    return Object.freeze({
      handlerId: String(entry.name || "anonymous"),
      order: 0,
      applyBootstrapPayload: entry
    });
  }

  if (!entry || typeof entry !== "object" || typeof entry.applyBootstrapPayload !== "function") {
    return null;
  }

  return Object.freeze({
    ...entry,
    handlerId: String(entry.handlerId || "anonymous"),
    order: Number.isFinite(entry.order) ? Number(entry.order) : 0
  });
}

function resolveBootstrapPayloadHandlers(scope) {
  if (!scope || typeof scope.resolveTag !== "function") {
    return [];
  }

  const rawEntries = scope.resolveTag(BOOTSTRAP_PAYLOAD_HANDLER_TAG);
  const queue = Array.isArray(rawEntries) ? [...rawEntries] : [rawEntries];
  const entries = [];

  while (queue.length > 0) {
    const entry = queue.shift();
    if (Array.isArray(entry)) {
      queue.push(...entry);
      continue;
    }
    const normalized = normalizeBootstrapPayloadHandler(entry);
    if (normalized) {
      entries.push(normalized);
    }
  }

  return entries.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.handlerId.localeCompare(right.handlerId);
  });
}

export {
  BOOTSTRAP_PAYLOAD_HANDLER_TAG,
  registerBootstrapPayloadHandler,
  resolveBootstrapPayloadHandlers
};
