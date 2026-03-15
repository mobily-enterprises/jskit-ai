import assert from "node:assert/strict";
import test from "node:test";
import { createContainer } from "../container/lib/container.js";
import {
  registerDomainEventListener,
  resolveDomainEventListeners,
  createDomainEvents
} from "./domainEvents.js";

test("registerDomainEventListener + resolveDomainEventListeners resolve canonical listeners", () => {
  const app = createContainer();

  registerDomainEventListener(app, "test.domainEvents.alpha", () => ({
    listenerId: "alpha",
    async handle() {}
  }));
  registerDomainEventListener(app, "test.domainEvents.zeta", () => ({
    listenerId: "zeta",
    async handle() {}
  }));

  const listeners = resolveDomainEventListeners(app);
  assert.deepEqual(
    listeners.map((listener) => listener.listenerId),
    ["alpha", "zeta"]
  );
  assert.equal(typeof listeners[0].handle, "function");
  assert.equal(typeof listeners[1].handle, "function");
});

test("createDomainEvents.publish dispatches listeners and applies matches filter", async () => {
  const app = createContainer();
  const calls = [];

  registerDomainEventListener(app, "test.domainEvents.alpha", () => ({
    listenerId: "alpha",
    matches(event) {
      return event.entity === "record";
    },
    async handle(event) {
      calls.push({
        listenerId: "alpha",
        event
      });
    }
  }));
  registerDomainEventListener(app, "test.domainEvents.beta", () => ({
    listenerId: "beta",
    async handle(event) {
      calls.push({
        listenerId: "beta",
        event
      });
    }
  }));

  const domainEvents = createDomainEvents(app);
  await domainEvents.publish({
    entity: "record",
    operation: "created"
  });
  await domainEvents.publish({
    entity: "other",
    operation: "created"
  });

  assert.deepEqual(calls, [
    {
      listenerId: "alpha",
      event: {
        entity: "record",
        operation: "created"
      }
    },
    {
      listenerId: "beta",
      event: {
        entity: "record",
        operation: "created"
      }
    },
    {
      listenerId: "beta",
      event: {
        entity: "other",
        operation: "created"
      }
    }
  ]);
});

test("createDomainEvents.publish ignores non-listener tag entries", async () => {
  const app = createContainer();

  registerDomainEventListener(app, "test.domainEvents.invalid", () => ({
    listenerId: "invalid"
  }));
  registerDomainEventListener(app, "test.domainEvents.valid", () => ({
    listenerId: "valid",
    async handle() {}
  }));

  const listeners = resolveDomainEventListeners(app);
  assert.deepEqual(
    listeners.map((listener) => listener.listenerId),
    ["valid"]
  );

  const domainEvents = createDomainEvents(app);
  const result = await domainEvents.publish({
    entity: "record"
  });
  assert.equal(result, null);
});
