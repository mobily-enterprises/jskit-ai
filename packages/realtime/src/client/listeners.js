import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { REALTIME_CLIENT_LISTENER_TAG } from "./tokens.js";

function normalizeListenerEntries(value) {
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

function normalizeRealtimeClientListener(entry) {
  if (typeof entry === "function") {
    return Object.freeze({
      listenerId: String(entry.name || "anonymous"),
      event: "*",
      matches: null,
      handle: entry
    });
  }

  if (entry && typeof entry === "object" && typeof entry.handle === "function") {
    const event = normalizeText(entry.event) || "*";
    return Object.freeze({
      ...entry,
      listenerId: String(entry.listenerId || "anonymous"),
      event,
      matches: typeof entry.matches === "function" ? entry.matches : null
    });
  }

  return null;
}

function registerRealtimeClientListener(app, token, factory) {
  if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
    throw new Error("registerRealtimeClientListener requires application singleton()/tag().");
  }

  app.singleton(token, factory);
  app.tag(token, REALTIME_CLIENT_LISTENER_TAG);
}

function resolveRealtimeClientListeners(scope) {
  if (!scope || typeof scope.resolveTag !== "function") {
    return [];
  }

  return normalizeListenerEntries(scope.resolveTag(REALTIME_CLIENT_LISTENER_TAG))
    .map((entry) => normalizeRealtimeClientListener(entry))
    .filter(Boolean);
}

export {
  normalizeRealtimeClientListener,
  registerRealtimeClientListener,
  resolveRealtimeClientListeners
};
