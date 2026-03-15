import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRealtimeClientListener,
  registerRealtimeClientListener,
  resolveRealtimeClientListeners
} from "../src/client/listeners.js";

function createSingletonApp() {
  const instances = new Map();
  const singletons = new Map();
  const tags = new Map();
  return {
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    tag(token, tagName) {
      const normalizedTagName = String(tagName || "").trim();
      if (!tags.has(normalizedTagName)) {
        tags.set(normalizedTagName, new Set());
      }
      tags.get(normalizedTagName).add(token);
    },
    resolveTag(tagName) {
      const normalizedTagName = String(tagName || "").trim();
      const tagged = tags.get(normalizedTagName);
      if (!tagged || tagged.size < 1) {
        return [];
      }
      return [...tagged].map((token) => this.make(token));
    },
    make(token) {
      if (instances.has(token)) {
        return instances.get(token);
      }
      if (!singletons.has(token)) {
        throw new Error(`Missing token: ${String(token)}`);
      }
      const resolved = singletons.get(token)(this);
      instances.set(token, resolved);
      return resolved;
    }
  };
}

test("normalizeRealtimeClientListener supports function shorthand", () => {
  const listener = normalizeRealtimeClientListener(function onAnyEvent() {});
  assert.equal(listener.listenerId, "onAnyEvent");
  assert.equal(listener.event, "*");
  assert.equal(typeof listener.handle, "function");
});

test("registerRealtimeClientListener + resolveRealtimeClientListeners round-trip", () => {
  const app = createSingletonApp();
  registerRealtimeClientListener(app, "listener.customers.changed", () => ({
    listenerId: "listener.customers.changed",
    event: "customers.record.changed",
    handle() {}
  }));

  const listeners = resolveRealtimeClientListeners(app);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].listenerId, "listener.customers.changed");
  assert.equal(listeners[0].event, "customers.record.changed");
  assert.equal(typeof listeners[0].handle, "function");
});
