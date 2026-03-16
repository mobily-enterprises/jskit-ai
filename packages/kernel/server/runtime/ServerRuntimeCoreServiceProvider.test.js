import assert from "node:assert/strict";
import test from "node:test";
import { createContainer } from "../container/lib/container.js";
import { KERNEL_TOKENS } from "../../shared/support/tokens.js";
import { registerDomainEventListener } from "./domainEvents.js";
import { ServerRuntimeCoreServiceProvider } from "./ServerRuntimeCoreServiceProvider.js";

test("ServerRuntimeCoreServiceProvider registers runtime.server and default domainEvents", () => {
  const app = createContainer();
  app.instance(KERNEL_TOKENS.Env, {
    JSKIT_STORAGE_DRIVER: "memory"
  });
  const provider = new ServerRuntimeCoreServiceProvider();
  provider.register(app);

  assert.equal(typeof app.service, "function");

  const runtimeServer = app.make("runtime.server");
  assert.equal(typeof runtimeServer, "object");

  const domainEvents = app.make("domainEvents");
  assert.equal(typeof domainEvents.publish, "function");

  const storage = app.make(KERNEL_TOKENS.Storage);
  assert.equal(typeof storage.setItemRaw, "function");
  assert.equal(typeof storage.getItemRaw, "function");
});

test("ServerRuntimeCoreServiceProvider storage binding supports raw writes", async () => {
  const app = createContainer();
  app.instance(KERNEL_TOKENS.Env, {
    JSKIT_STORAGE_DRIVER: "memory"
  });

  const provider = new ServerRuntimeCoreServiceProvider();
  provider.register(app);

  const storage = app.make(KERNEL_TOKENS.Storage);
  const input = Buffer.from("hello");
  await storage.setItemRaw("tests/runtime/storage.raw", input);
  const output = await storage.getItemRaw("tests/runtime/storage.raw");

  assert.ok(Buffer.isBuffer(output));
  assert.equal(output.toString(), "hello");
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
