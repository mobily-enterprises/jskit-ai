import assert from "node:assert/strict";
import test from "node:test";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";

test("providers receive named required and optional capabilities without a service locator", async () => {
  const calls = [];
  const databaseProvider = defineProvider({
    id: "database.mysql",
    requires: { env: "runtime.env" },
    provides: { database: "runtime.database" },
    setup({ env }) {
      calls.push(["database", env.DB_NAME]);
      return { database: Object.freeze({ client: "mysql2" }) };
    }
  });
  const booksProvider = defineProvider({
    id: "feature.books",
    requires: { database: "runtime.database" },
    optional: { logger: "runtime.logger" },
    provides: { books: "feature.books" },
    setup({ database, logger }) {
      calls.push(["books", database.client, logger]);
      return { books: Object.freeze({ ready: true }) };
    }
  });

  const runtime = createCapabilityRuntime({
    providers: [booksProvider, databaseProvider],
    inputs: {
      "runtime.env": { DB_NAME: "catalogue" }
    }
  });
  await runtime.start();

  assert.deepEqual(calls, [
    ["database", "catalogue"],
    ["books", "mysql2", null]
  ]);
  assert.deepEqual(runtime.diagnostics(), {
    profile: "",
    lifecycleState: "started",
    providerOrder: ["database.mysql", "feature.books"],
    capabilityIds: ["feature.books", "runtime.database", "runtime.env"]
  });
  assert.equal(Object.hasOwn(runtime, "get"), false);
  assert.equal(Object.hasOwn(runtime, "make"), false);
  assert.equal(Object.hasOwn(runtime, "has"), false);
});

test("provider lifecycle receives only declared dependencies and its own outputs", async () => {
  const calls = [];
  const provider = defineProvider({
    id: "feature.lifecycle",
    provides: { feature: "feature.lifecycle" },
    setup(dependencies, context) {
      calls.push(["setup", dependencies, context.profile]);
      return { feature: { ok: true } };
    },
    boot(dependencies, context) {
      calls.push(["boot", dependencies, context.outputs.feature.ok]);
    },
    shutdown(dependencies, context) {
      calls.push(["shutdown", dependencies, context.outputs.feature.ok]);
    }
  });
  const runtime = createCapabilityRuntime({ providers: [provider], profile: "test" });

  await runtime.start();
  assert.deepEqual(await runtime.shutdown(), ["feature.lifecycle"]);
  assert.deepEqual(calls, [
    ["setup", {}, "test"],
    ["boot", {}, true],
    ["shutdown", {}, true]
  ]);
});

test("capability runtime rejects missing, duplicate, cyclic, and undeclared capabilities", async () => {
  assert.throws(
    () => createCapabilityRuntime({
      providers: [defineProvider({
        id: "feature.missing",
        requires: { database: "runtime.database" },
        setup() {}
      })]
    }),
    /requires missing capability "runtime\.database"/u
  );

  const first = defineProvider({
    id: "feature.first",
    provides: { value: "feature.value" },
    setup() {
      return { value: 1 };
    }
  });
  const second = defineProvider({
    id: "feature.second",
    provides: { value: "feature.value" },
    setup() {
      return { value: 2 };
    }
  });
  assert.throws(
    () => createCapabilityRuntime({ providers: [first, second] }),
    /provided by both feature\.first and feature\.second/u
  );

  const left = defineProvider({
    id: "feature.left",
    requires: { right: "feature.right" },
    provides: { left: "feature.left" },
    setup() {
      return { left: true };
    }
  });
  const right = defineProvider({
    id: "feature.right",
    requires: { left: "feature.left" },
    provides: { right: "feature.right" },
    setup() {
      return { right: true };
    }
  });
  assert.throws(
    () => createCapabilityRuntime({ providers: [left, right] }),
    /Provider capability cycle detected/u
  );

  const undeclared = defineProvider({
    id: "feature.undeclared",
    provides: { expected: "feature.expected" },
    setup() {
      return { expected: true, extra: true };
    }
  });
  const runtime = createCapabilityRuntime({ providers: [undeclared] });
  await assert.rejects(runtime.start(), /outputs must be exactly: expected/u);
});

test("failed startup shuts down initialized providers and normal shutdown is idempotent", async () => {
  const calls = [];
  const first = defineProvider({
    id: "feature.first",
    provides: { first: "feature.first" },
    setup() {
      calls.push("first.setup");
      return { first: true };
    },
    shutdown() {
      calls.push("first.shutdown");
    }
  });
  const failing = defineProvider({
    id: "feature.failing",
    requires: { first: "feature.first" },
    setup() {
      calls.push("failing.setup");
      throw new Error("setup failed");
    }
  });
  const failedRuntime = createCapabilityRuntime({ providers: [failing, first] });
  await assert.rejects(failedRuntime.start(), /setup failed/u);
  assert.deepEqual(calls, ["first.setup", "failing.setup", "first.shutdown"]);
  assert.equal(failedRuntime.diagnostics().lifecycleState, "failed");

  const healthyRuntime = createCapabilityRuntime({ providers: [first] });
  await healthyRuntime.start();
  assert.deepEqual(await healthyRuntime.shutdown(), ["feature.first"]);
  assert.deepEqual(await healthyRuntime.shutdown(), []);
});
