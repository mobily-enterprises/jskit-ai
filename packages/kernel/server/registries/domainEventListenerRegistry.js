import { normalizeObject } from "../../shared/support/normalize.js";
import { registerTaggedSingleton, resolveTaggedEntries } from "./primitives.js";

const DOMAIN_EVENT_LISTENER_TAG = Symbol.for("jskit.runtime.domainEvent.listeners");

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
  registerTaggedSingleton(app, token, factory, DOMAIN_EVENT_LISTENER_TAG, {
    context: "registerDomainEventListener"
  });
}

function resolveDomainEventListeners(scope) {
  return resolveTaggedEntries(scope, DOMAIN_EVENT_LISTENER_TAG)
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
