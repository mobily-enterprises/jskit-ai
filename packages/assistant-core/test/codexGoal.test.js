import assert from "node:assert/strict";
import test from "node:test";
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
