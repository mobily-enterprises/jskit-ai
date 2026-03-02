import assert from "node:assert/strict";
import test from "node:test";
import {
  DuplicateProviderError,
  ProviderDependencyError,
  createApplication,
  createProviderClass
} from "../src/lib/index.js";

test("providers register and boot in dependency order", async () => {
  const order = [];

  const ConfigProvider = createProviderClass({
    id: "config",
    register(app) {
      app.instance("config", { appName: "value-app" });
      order.push("register:config");
    },
    boot() {
      order.push("boot:config");
    }
  });

  const AuthProvider = createProviderClass({
    id: "auth",
    dependsOn: ["config"],
    register(app) {
      const config = app.make("config");
      app.instance("authEnabled", Boolean(config.appName));
      order.push("register:auth");
    },
    boot() {
      order.push("boot:auth");
    }
  });

  const app = createApplication({ profile: "app" });
  await app.start({ providers: [AuthProvider, ConfigProvider] });

  assert.deepEqual(order, ["register:config", "register:auth", "boot:config", "boot:auth"]);
  assert.equal(app.make("authEnabled"), true);

  const diagnostics = app.getDiagnostics();
  assert.deepEqual(diagnostics.providerOrder, ["config", "auth"]);
  assert.deepEqual(diagnostics.bootedOrder, ["config", "auth"]);
});

test("duplicate provider ids fail fast", async () => {
  const A = createProviderClass({ id: "dup" });
  const B = createProviderClass({ id: "dup" });
  const app = createApplication();

  await assert.rejects(() => app.start({ providers: [A, B] }), DuplicateProviderError);
});

test("missing provider dependency fails fast", async () => {
  const NeedsConfigProvider = createProviderClass({
    id: "auth",
    dependsOn: ["config"]
  });
  const app = createApplication();

  await assert.rejects(() => app.start({ providers: [NeedsConfigProvider] }), ProviderDependencyError);
});

test("provider dependency cycle fails fast", async () => {
  const A = createProviderClass({ id: "a", dependsOn: ["b"] });
  const B = createProviderClass({ id: "b", dependsOn: ["a"] });
  const app = createApplication();

  await assert.rejects(() => app.start({ providers: [A, B] }), ProviderDependencyError);
});

test("shutdown runs in reverse boot order", async () => {
  const events = [];

  const First = createProviderClass({
    id: "first",
    boot() {
      events.push("boot:first");
    },
    shutdown() {
      events.push("shutdown:first");
    }
  });

  const Second = createProviderClass({
    id: "second",
    dependsOn: ["first"],
    boot() {
      events.push("boot:second");
    },
    shutdown() {
      events.push("shutdown:second");
    }
  });

  const app = createApplication();
  await app.start({ providers: [Second, First] });

  const shutdownOrder = await app.shutdown();
  assert.deepEqual(shutdownOrder, ["second", "first"]);
  assert.deepEqual(events, ["boot:first", "boot:second", "shutdown:second", "shutdown:first"]);
});
