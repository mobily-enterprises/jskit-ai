import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServerAgentProvider } from "../src/server/conversation/codexProvider.js";
import { createCodexGoalCommands } from "../src/server/conversation/codexGoalCommands.js";
import { createCodexAppServerProviderOwner } from "../src/server/conversation/codexProviderOwner.js";

test("cached goal reads retain the original session and interactive-provider boundary", async t => {
  const owner = createCodexAppServerProviderOwner();
  const keys = [];
  const reads = [];
  t.after(() => keys.forEach(key => owner.closeProvider(key)));
  function retain(key, sessionKey, { helper = false, available = true } = {}) {
    keys.push(key);
    return owner.createProvider({ providerKey: key,
      providerOptions: { runtimeDir: `/tmp/cached-goal-${key}` }, owner: { sessionKey },
      create: () => ({
        isHelperProvider: () => helper,
        isAvailable: () => available,
        async readGoal(threadId) { reads.push([key, threadId]); return { goal: { status: "paused" } }; },
        ensureAvailable() { assert.fail("Reading a goal must not acquire a provider"); },
        close() {}
      }) });
  }
  assert.deepEqual(await owner.readSessionGoal("one", ""), { status: "available", threadId: "", goal: null });
  assert.deepEqual(await owner.readSessionGoal("one", "thread-one"), { status: "unavailable", goal: null });
  retain("other", "two");
  retain("helper", "one", { helper: true });
  retain("disconnected", "one", { available: false });
  assert.deepEqual(await owner.readSessionGoal("one", "thread-one"), { status: "unavailable", goal: null });
  assert.deepEqual(reads, []);
  const interactive = retain("interactive", "one");
  assert.deepEqual(await owner.readSessionGoal("one", "thread-one"), {
    status: "available", threadId: "thread-one", goal: { status: "paused" }
  });
  assert.deepEqual(reads, [["interactive", "thread-one"]]);
  const failure = new Error("Native goal read failed");
  interactive.readGoal = async () => { throw failure; };
  await assert.rejects(owner.readSessionGoal("one", "thread-one"), error => error === failure);
});


test("next-turn Codex settings wait for their applied snapshot and release observation on failure", async t => {
  const provider = new CodexAppServerAgentProvider({}, { credentials: { assertCurrent() {} } });
  t.after(() => provider.close());
  const requests = [];
  const observers = new Set();
  let queued = Promise.withResolvers();
  let reject = false;
  provider.client = { isOpen: () => true, close() {},
    subscribe(callback) { observers.add(callback); return () => observers.delete(callback); },
    async request(method, params, options) {
      requests.push({ method, params });
      assert.equal(options.signal.aborted, false);
      if (method === "thread/read") return { thread: { model: "old-model", reasoningEffort: "low" } };
      queued.resolve();
      if (reject) throw new Error("Native settings rejected");
      return {};
    }
  };
  const publish = (threadId, model, effort) => {
    for (const observer of observers) observer({ method: "thread/settings/updated", params: {
      threadId, threadSettings: { model, effort }
    } });
  };
  let settled = false;
  const pending = provider.updateThreadSettings("thread-one", { model: "model-two", effort: "high" }).then(result => {
    settled = true;
    return result;
  });
  await queued.promise;
  publish("other-thread", "model-two", "high");
  publish("thread-one", "old-model", "high");
  publish("thread-one", "model-two", "low");
  await Promise.resolve();
  assert.equal(settled, false, "An acknowledgement or unrelated settings snapshot cannot confirm this change");
  publish("thread-one", "model-two", "high");
  assert.deepEqual(await pending, {});
  assert.equal(observers.size, 0);
  assert.deepEqual(requests, [{ method: "thread/read", params: { threadId: "thread-one", includeTurns: false } },
    { method: "thread/settings/update", params: {
    threadId: "thread-one", model: "model-two", effort: "high"
  } }]);
  await assert.rejects(provider.updateThreadSettings("", { model: "model" }), /existing thread/);
  await assert.rejects(provider.updateThreadSettings("thread-one", { model: "" }), /existing thread/);
  assert.equal(requests.length, 2);
  reject = true;
  await assert.rejects(provider.updateThreadSettings("thread-one", { model: "model-two" }), /Native settings rejected/);
  assert.equal(observers.size, 0);
  reject = false;
  queued = Promise.withResolvers();
  const closing = provider.updateThreadSettings("thread-one", { model: "model-three" });
  await queued.promise;
  provider.close();
  await assert.rejects(closing, /closed before confirming/);
  assert.equal(observers.size, 0);
});

test("already-applied Codex settings need no update event", async t => {
  const provider = new CodexAppServerAgentProvider({}, { credentials: { assertCurrent() {} } });
  t.after(() => provider.close());
  let observing = 0;
  provider.client = { isOpen: () => true, close() {},
    subscribe() { observing++; return () => { observing--; }; },
    async request(method, params) {
      assert.equal(method, "thread/read", "Matching native settings must not enqueue a redundant update");
      assert.equal(params.threadId, "thread-one");
      return { thread: { model: "model-one", reasoningEffort: "high" } };
    }
  };
  assert.deepEqual(await provider.updateThreadSettings("thread-one", { model: "model-one", effort: "high" }), {});
  assert.equal(observing, 0);
});

for (const pause of [false, true]) {
  test(`provider settings retain native goal identity across reload${pause ? " and user Pause" : ""}`, async t => {
    let credentialsRevision = 1;
    const prepared = [];
    const provider = new CodexAppServerAgentProvider({
      prepareThreadEnvironment: async environment => environment,
      prepareThreadParams: async params => {
        prepared.push(credentialsRevision);
        return { ...params, modelProvider: "deepseek", config: { ...params.config,
          "model_providers.deepseek": { testRevision: credentialsRevision } } };
      }
    }, { credentials: { assertCurrent() {} } });
    t.after(() => provider.close());
    const observers = new Set();
    const requests = [];
    let status = "active", modelProvider = "openai";
    let goal = { status: "active", createdAt: 1, updatedAt: 1, objective: "Finish validation", tokenBudget: 100, tokensUsed: 40 };
    let publishSettings;
    const submitted = Promise.withResolvers();
    const emit = notification => {
      for (const observer of observers) observer(notification);
      provider.publishNotification(notification);
    };
    provider.client = { isOpen: () => true, close() {},
      subscribe(callback) { observers.add(callback); return () => observers.delete(callback); },
      async request(method, params) {
        requests.push({ method, params });
        if (method === "thread/read") return { thread: { status, modelProvider, historyMode: "paginated" } };
        if (method === "thread/goal/get") return { goal: goal && { ...goal } };
        if (method === "thread/goal/set") {
          goal = { ...goal, status: params.status, updatedAt: goal.updatedAt + 1 };
          emit({ method: "thread/goal/updated", params: { threadId: "native", goal: { ...goal } } });
          return { goal: { ...goal } };
        }
        if (method === "thread/unsubscribe") { status = "notLoaded"; return { status: "unsubscribed" }; }
        if (method === "thread/resume") {
          assert.equal(goal.status, "paused");
          assert.equal(params.config["model_providers.deepseek"].testRevision, 2, "Credentials are prepared again at the turn boundary");
          assert.equal(params.config.model_reasoning_effort, "low");
          status = "idle"; modelProvider = params.modelProvider;
          return { modelProvider };
        }
        if (method === "thread/settings/update") {
          publishSettings = () => emit({ method: "thread/settings/updated", params: {
            threadId: "native", threadSettings: { model: params.model, effort: params.effort }
          } });
          submitted.resolve();
          return {};
        }
        assert.fail(`Unexpected native request ${method}`);
      }
    };
    const goalEvents = [];
    provider.subscribe(event => { if (event.method === "thread/goal/updated") goalEvents.push(event.params.goal.status); });
    assert.deepEqual(await provider.updateThreadSettings("native", { model: "deepseek-model", effort: "low" }), { ok: true, pending: true });
    const applying = provider.threadEnvironmentTasks.get("native");
    assert.equal((await provider.readGoal("native")).goal.status, "active");
    assert.deepEqual(goalEvents, ["active"], "Internal scheduling holds never expose a false Resume action");
    if (pause) {
      await provider.setGoalStatus("native", "paused");
      assert.equal((await provider.readGoal("native")).goal.status, "paused");
    }
    credentialsRevision = 2;
    status = "idle";
    await submitted.promise;
    assert.equal(goal.status, "paused", "Queued settings do not release automatic scheduling before application");
    publishSettings();
    await applying;
    assert.equal(modelProvider, "deepseek");
    assert.equal(goal.status, pause ? "paused" : "active");
    assert.equal(goal.createdAt, 1);
    assert.equal(goal.tokenBudget, 100);
    assert.equal(goal.tokensUsed, 40);
    assert.deepEqual(prepared, [1, 2]);
    assert.equal(requests.some(row => row.method === "turn/interrupt" || row.method === "turn/start"), false);
  });
}

for (const action of ["set", "resume"]) test(`cancelled Codex goal ${action} cannot dispatch after native goal read`, async () => {
  const controller = new AbortController();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let writes = 0;
  const goal = { status: "paused", objective: "Finish the checks", createdAt: 1 };
  const owner = createCodexGoalCommands({ turnState: () => ({ status: "interrupted" }),
    subscribeCodexAppServerEvents() {}, reconcileCodexAppServerGoalUpdated: async () => {}, publish: async () => {} });
  const provider = {
    async readGoal() { entered.resolve(); await release.promise; return { goal: action === "set" ? null : goal }; },
    async setGoal() { writes++; return { goal }; }, async setGoalStatus() { writes++; return { goal }; }
  };
  const operation = owner.updateCodexAppServerGoal("session", { action, threadId: "native", ...goal },
    { context: { threadId: "native", provider, session: {} }, signal: controller.signal });
  void operation.catch(() => {});
  await entered.promise;
  controller.abort(new Error("Goal stopped"));
  release.resolve();
  await assert.rejects(operation, /Goal stopped/);
  assert.equal(writes, 0);
});

for (const action of ["set", "resume"]) test(`Codex goal ${action} forwards cancellation through provider preparation`, async t => {
  const controller = new AbortController();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const provider = new CodexAppServerAgentProvider({}, { credentials: { assertCurrent() {} } });
  t.after(() => provider.close());
  const goal = { status: "paused", objective: "Finish the checks", createdAt: 1 };
  const writes = [];
  provider.readGoal = async () => ({ goal: action === "set" ? null : goal });
  provider.activeClient = async () => { entered.resolve(); await release.promise; return {
    async request(method, input, { signal }) { signal.throwIfAborted(); writes.push({ method, input }); return { goal }; }
  }; };
  const owner = createCodexGoalCommands({ turnState: () => ({ status: "interrupted" }),
    subscribeCodexAppServerEvents() {}, reconcileCodexAppServerGoalUpdated: async () => {}, publish: async () => {} });
  const operation = owner.updateCodexAppServerGoal("session", { action, threadId: "native", ...goal },
    { context: { threadId: "native", provider, session: {} }, signal: controller.signal });
  void operation.catch(() => {});
  await entered.promise;
  controller.abort(new Error("Goal stopped"));
  release.resolve();
  await assert.rejects(operation, /Goal stopped/);
  assert.deepEqual(writes, []);
});
