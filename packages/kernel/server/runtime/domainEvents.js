import { normalizeObject } from "../../shared/support/normalize.js";

const DOMAIN_EVENT_LISTENER_TAG = Symbol.for("jskit.runtime.domainEvent.listeners");

function normalizeListenerList(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const listeners = [];

  while (queue.length > 0) {
    const entry = queue.shift();
    if (Array.isArray(entry)) {
      queue.push(...entry);
      continue;
    }
    if (entry == null) {
      continue;
    }
    listeners.push(entry);
  }

  return listeners;
}

function normalizeDomainEventListener(entry) {
  if (typeof entry === "function") {
    return {
      listenerId: String(entry.name || "anonymous"),
      matches: null,
      handle: entry
    };
  }

  if (entry && typeof entry === "object" && typeof entry.handle === "function") {
    return {
      ...entry,
      listenerId: String(entry.listenerId || "anonymous"),
      matches: typeof entry.matches === "function" ? entry.matches : null
    };
  }

  return null;
}

function registerDomainEventListener(app, token, factory) {
  if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
    throw new Error("registerDomainEventListener requires application singleton()/tag().");
  }

  app.singleton(token, factory);
  app.tag(token, DOMAIN_EVENT_LISTENER_TAG);
}

function resolveDomainEventListeners(scope) {
  if (!scope || typeof scope.resolveTag !== "function") {
    return [];
  }

  return normalizeListenerList(scope.resolveTag(DOMAIN_EVENT_LISTENER_TAG))
    .map((entry) => normalizeDomainEventListener(entry))
    .filter(Boolean);
}

function createDomainEvents(scope) {
  return Object.freeze({
    async publish(event = {}) {
      const payload = normalizeObject(event);
      const listeners = resolveDomainEventListeners(scope);

      for (const listener of listeners) {
        if (listener.matches && listener.matches(payload) !== true) {
          continue;
        }
        await listener.handle(payload);
      }

      return null;
    }
  });
}

export {
  DOMAIN_EVENT_LISTENER_TAG,
  registerDomainEventListener,
  resolveDomainEventListeners,
  createDomainEvents
};
