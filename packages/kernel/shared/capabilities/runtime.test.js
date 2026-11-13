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
    capabilityIds: ["feature.books", "runtime.database", "runtime.env"],
    providerShutdowns: []
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
  // A provider's hint for a required capability is added to the error that says it is missing.
  assert.throws(
    () => createCapabilityRuntime({
      providers: [defineProvider({
        id: "feature.hinted",
        requires: { database: "runtime.database" },
        hints: { "runtime.database": "Install the database runtime." },
        setup() {}
      })]
    }),
    { message: 'Provider "feature.hinted" requires missing capability "runtime.database". Install the database runtime.' }
  );
  assert.throws(() => defineProvider({ id: "feature.hinted", hints: { "runtime.database": "Install it." }, setup() {} }),
    /feature\.hinted\.hints names "runtime\.database", which the provider does not require\./u);
  assert.throws(() => defineProvider({ id: "feature.hinted", requires: { database: "runtime.database" }, hints: { "runtime.database": " " }, setup() {} }),
    /must be the text that says what to register/u);

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

// What reading a late requirement throws before every provider has booted.
function readTooEarly(providerId, localName, capabilityId) {
  return {
    message: `Provider "${providerId}" read its late requirement "${localName}" (capability "${capabilityId}") before every provider booted: a late requirement can only be read at call time after boot, such as inside a row policy or a request handler, never in setup or boot, and never destructured in setup.`
  };
}

/**
 * A ring: the reports require the history, and the history late-requires the reports. `read` reads the history's
 * dependencies in its setup or boot, as a test asks.
 * @param {string[]} calls
 * @param {{ setupRead?: (dependencies: any) => unknown, bootRead?: (dependencies: any) => unknown }} [read]
 */
function reportsAndHistory(calls, { setupRead = () => null, bootRead = () => null } = {}) {
  const reports = defineProvider({
    id: "feature.reports",
    requires: { history: "feature.history" },
    provides: { reports: "feature.reports" },
    setup() {
      calls.push("reports.setup");
      return { reports: Object.freeze({ name: "reports" }) };
    }
  });
  const history = defineProvider({
    id: "feature.history",
    late: { reports: "feature.reports" },
    provides: { history: "feature.history" },
    setup(dependencies) {
      calls.push("history.setup");
      setupRead(dependencies);
      return { history: Object.freeze({ dependencies, reportsName: () => dependencies.reports.name }) };
    },
    boot(dependencies) {
      calls.push("history.boot");
      bootRead(dependencies);
    },
    shutdown() {
      calls.push("history.shutdown");
    }
  });
  return [reports, history];
}

test("a late requirement closes a ring that starts: it takes no part in the start order, and is read at call time after every boot", async () => {
  const calls = [];
  let received = null;
  const reader = defineProvider({
    id: "test.reader",
    requires: { history: "feature.history", reports: "feature.reports" },
    setup(values) {
      received = values;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({ providers: [...reportsAndHistory(calls), reader] });
  assert.deepEqual(runtime.diagnostics().providerOrder, ["feature.history", "feature.reports", "test.reader"]);
  await runtime.start();

  assert.deepEqual(calls, ["history.setup", "reports.setup", "history.boot"]);
  assert.equal(received.history.reportsName(), "reports");
  const { dependencies } = received.history;
  assert.equal(dependencies.reports, received.reports, "the reports' own capability, resolved once");
  assert.deepEqual(Object.keys(dependencies), ["reports"]);
  assert.equal(Object.isFrozen(dependencies), true);
  assert.deepEqual(await runtime.shutdown(), ["test.reader", "feature.reports", "feature.history"]);
  assert.equal(dependencies.reports, received.reports, "still readable once shut down");
});

test("a late requirement read in setup or boot, or destructured in setup, fails start(), naming the provider, its local name and the capability", async () => {
  for (const [read, expectedCalls] of [
    [{ setupRead: (dependencies) => dependencies.reports }, ["history.setup"]],
    [{ setupRead: ({ reports }) => reports }, ["history.setup"]],
    [{ bootRead: (dependencies) => dependencies.reports }, ["history.setup", "reports.setup", "history.boot", "history.shutdown"]]
  ]) {
    const calls = [];
    const runtime = createCapabilityRuntime({ providers: reportsAndHistory(calls, read) });
    await assert.rejects(runtime.start(), readTooEarly("feature.history", "reports", "feature.reports"));
    assert.deepEqual(calls, expectedCalls);
    assert.equal(runtime.diagnostics().lifecycleState, "failed");
  }

  // The capability's provider has set up and booted before the reader boots, and the read still fails: every late
  // requirement resolves after the last boot.
  const clock = defineProvider({ id: "feature.a-clock", provides: { clock: "feature.clock" }, setup: () => ({ clock: {} }), boot() {} });
  const reader = defineProvider({
    id: "feature.b-reader",
    late: { clock: "feature.clock" },
    setup: () => ({}),
    boot(dependencies) {
      return dependencies.clock;
    }
  });
  const runtime = createCapabilityRuntime({ providers: [reader, clock] });
  assert.deepEqual(runtime.diagnostics().providerOrder, ["feature.a-clock", "feature.b-reader"]);
  await assert.rejects(runtime.start(), readTooEarly("feature.b-reader", "clock", "feature.clock"));
});

test("a missing late requirement fails start() once every provider has booted, naming the provider and the capability, and cleans up", async () => {
  const calls = [];
  let received = null;
  const lonely = defineProvider({
    id: "feature.lonely",
    late: { reports: "feature.reports" },
    hints: { "feature.reports": "Register the reports feature." },
    setup(dependencies) {
      calls.push("setup");
      received = dependencies;
      return {};
    },
    boot() {
      calls.push("boot");
    },
    shutdown() {
      calls.push("shutdown");
    }
  });
  // Unlike a missing plain requirement, it lets the runtime be created; start() refuses it at the end of boot.
  const runtime = createCapabilityRuntime({ providers: [lonely] });
  await assert.rejects(runtime.start(), {
    message: 'Provider "feature.lonely" late-requires missing capability "feature.reports": no provider or runtime input provides it. Register the reports feature.'
  });
  assert.deepEqual(calls, ["setup", "boot", "shutdown"]);
  assert.equal(runtime.diagnostics().lifecycleState, "failed");

  // A runtime input gives it, as it gives a plain requirement.
  const reports = Object.freeze({ name: "input" });
  await createCapabilityRuntime({ providers: [lonely], inputs: { "feature.reports": reports } }).start();
  assert.equal(received.reports, reports);
});

test("a late requirement is checked when its provider is defined", () => {
  const define = (fields) => () => defineProvider({ id: "feature.x", setup() {}, ...fields });
  assert.throws(define({ late: "feature.y" }), { message: "feature.x.late must be an object mapping local names to capability ids." });
  assert.throws(define({ late: { "1y": "feature.y" } }), { message: 'feature.x.late local name "1y" must be a JavaScript identifier.' });
  assert.throws(define({ late: { y: "Feature Y" } }), /^TypeError: feature\.x\.late\.y must match/u);
  assert.throws(define({ late: { y: "feature.y", alsoY: " Feature.Y " } }), { message: 'feature.x.late declares capability "feature.y" more than once.' });
  assert.throws(define({ requires: { y: "feature.y" }, late: { y: "feature.z" } }), { message: 'Provider local name "y" is declared by both requires and late.' });
  assert.throws(define({ late: { x: "feature.z" }, provides: { x: "feature.x" } }), { message: 'Provider local name "x" is declared by both late and provides.' });
  // Its own capability, in any spelling the runtime resolves to it.
  assert.throws(define({ late: { self: " Feature.X " }, provides: { x: "feature.x" } }), {
    message: 'Provider "feature.x" cannot late-require capability "feature.x" that it provides.'
  });
  assert.throws(define({ requires: { y: "feature.y" }, late: { lateY: "feature.y" } }), {
    message: 'Provider "feature.x" names capability "feature.y" under both late and requires.'
  });
  assert.throws(define({ optional: { y: "feature.y" }, late: { lateY: "feature.y" } }), {
    message: 'Provider "feature.x" names capability "feature.y" under both late and optional.'
  });

  const provider = defineProvider({ id: "feature.x", late: { y: " Feature.Y " }, hints: { "feature.y": "Register Y." }, setup() {} });
  assert.deepEqual([provider.late, provider.hints], [{ y: "feature.y" }, { "feature.y": "Register Y." }]);
  assert.equal(Object.isFrozen(provider.late), true);
  assert.deepEqual(defineProvider({ id: "feature.x", setup() {} }).late, {});
});

// A provider with no outputs and the given shutdown hook, if any.
function shutdownProvider(id, shutdown) {
  return defineProvider({ id, setup() { return {}; }, shutdown });
}

test("shutdown stops every provider and reports each failing provider by id", async () => {
  const stopped = [];
  const runtime = createCapabilityRuntime({ providers: [
    shutdownProvider("feature.alpha", () => { stopped.push("alpha"); throw new Error("alpha close failed"); }),
    shutdownProvider("feature.beta", () => { stopped.push("beta"); throw Object.assign(new Error("socket close failed"), { code: "E_SOCKET" }); }),
    shutdownProvider("feature.gamma", () => { stopped.push("gamma"); })
  ] });
  await runtime.start();

  const error = await runtime.shutdown().then(() => null, (reason) => reason);
  assert.deepEqual(stopped, ["gamma", "beta", "alpha"], "a failing provider does not skip the providers stopped after it");
  assert.ok(error instanceof AggregateError);
  assert.match(error.message, /feature\.beta, feature\.alpha/u);
  assert.deepEqual(error.errors.map(({ providerId, message, cause }) => ({ providerId, message, cause: cause.message })), [
    { providerId: "feature.beta", message: 'Provider "feature.beta" shutdown failed: socket close failed', cause: "socket close failed" },
    { providerId: "feature.alpha", message: 'Provider "feature.alpha" shutdown failed: alpha close failed', cause: "alpha close failed" }
  ]);
  assert.equal(error.errors[0].cause.code, "E_SOCKET");
  assert.deepEqual(runtime.diagnostics().providerShutdowns.map(({ id, status }) => ({ id, status })), [
    { id: "feature.gamma", status: "stopped" },
    { id: "feature.beta", status: "failed" },
    { id: "feature.alpha", status: "failed" }
  ]);
});

test("diagnostics name the provider whose shutdown is still running and how long each took", async () => {
  const held = Promise.withResolvers();
  const runtime = createCapabilityRuntime({ providers: [
    shutdownProvider("feature.a-slow", () => held.promise),
    shutdownProvider("feature.b-quick", () => {}),
    shutdownProvider("feature.c-plain")
  ] });
  await runtime.start();
  assert.deepEqual(runtime.diagnostics().providerShutdowns, []);

  const stopping = runtime.shutdown();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const pending = runtime.diagnostics().providerShutdowns;
  assert.deepEqual(pending.map(({ id, status }) => ({ id, status })), [
    { id: "feature.b-quick", status: "stopped" },
    { id: "feature.a-slow", status: "stopping" }
  ], "providers without a shutdown hook are not listed");
  assert.ok(pending.every(({ durationMs }) => Number.isInteger(durationMs) && durationMs >= 0));
  assert.ok(pending[1].durationMs >= 20, "the pending provider reports its elapsed time");

  held.resolve();
  assert.deepEqual(await stopping, ["feature.c-plain", "feature.b-quick", "feature.a-slow"]);
  assert.equal(runtime.diagnostics().providerShutdowns.at(-1).status, "stopped");
});
