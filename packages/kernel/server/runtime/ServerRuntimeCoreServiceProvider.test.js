import assert from "node:assert/strict";
import test from "node:test";
import { KERNEL_TOKENS } from "../../shared/support/tokens.js";
import { createContainer } from "../container/lib/container.js";
import { registerDomainEventListener } from "./domainEvents.js";
import { ServerRuntimeCoreServiceProvider } from "./ServerRuntimeCoreServiceProvider.js";

test("ServerRuntimeCoreServiceProvider registers runtime.server and default domainEvents", () => {
  const app = createContainer();
  const provider = new ServerRuntimeCoreServiceProvider();
  provider.register(app);

  assert.equal(typeof app.service, "function");

  const runtimeServer = app.make("runtime.server");
  assert.equal(typeof runtimeServer, "object");

  const domainEvents = app.make("domainEvents");
  assert.equal(typeof domainEvents.publish, "function");
  const schemaCatalog = app.make(KERNEL_TOKENS.ServiceSchemaCatalog);
  assert.equal(typeof schemaCatalog.listServiceMethodSchemas, "function");
});

test("ServerRuntimeCoreServiceProvider default domainEvents dispatches registered listeners", async () => {
  const app = createContainer();
  const provider = new ServerRuntimeCoreServiceProvider();
  provider.register(app);

  const received = [];
  registerDomainEventListener(app, "test.domainEvents.alpha", () => ({
    listenerId: "alpha",
    async handle(payload) {
      received.push(payload);
    }
  }));

  const domainEvents = app.make("domainEvents");
  const eventPayload = {
    source: "test"
  };
  const result = await domainEvents.publish(eventPayload);

  assert.equal(result, null);
  assert.deepEqual(received, [eventPayload]);
});

test("ServerRuntimeCoreServiceProvider owns domainEvents binding", async () => {
  const app = createContainer();
  app.singleton("domainEvents", () => ({ publish: async () => "existing" }));

  const provider = new ServerRuntimeCoreServiceProvider();
  assert.throws(
    () => provider.register(app),
    /Token "domainEvents" is already bound\./
  );
});
