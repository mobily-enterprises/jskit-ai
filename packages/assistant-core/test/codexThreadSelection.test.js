import assert from "node:assert/strict";
import test from "node:test";
import { ensureCodexAppServerThread } from "../src/server/conversation/codexProvider.js";

test("retained Codex selection awaits observation before resume and identity publication before return", async () => {
  const calls = [];
  const stages = [];
  const observation = Promise.withResolvers();
  const observing = Promise.withResolvers();
  const publication = Promise.withResolvers();
  const publishing = Promise.withResolvers();
  const runtime = { id: "shared-runtime" };
  const settings = { model: "selected-model" };
  let paused = true;
  let finished = false;
  const selected = ensureCodexAppServerThread({
    workdir: " /repo/worktree ",
    provider: {
      async ensureAvailable() { calls.push(["available"]); return { runtime }; },
      async ensureRuntime() { assert.fail("An available runtime must be reused"); },
      async readGoal(id) { calls.push(["goal", id]); return { goal: { status: "active" } }; },
      async setGoalStatus(id, status) { calls.push(["pause", id, status]); },
      async resumeThread(id, input) { calls.push(["resume", id]); assert.equal(input, settings); return { id }; },
      async startThread() { assert.fail("A retained thread must never be replaced"); }
    },
    async settings(workdir) {
      calls.push(["prepare", workdir]);
      return { threadSettings: settings };
    },
    async observeThread(id) {
      calls.push(["observe", id]);
      observing.resolve();
      await observation.promise;
    },
    identity: {
      read: () => "original-codex",
      get pauseGoal() { return paused; },
      async clearPause() { calls.push(["clear"]); paused = false; },
      async write(value) {
        calls.push(["write", value.threadId]);
        assert.deepEqual(value, { appServerRuntime: runtime, threadId: "original-codex", workdir: "/repo/worktree" });
        publishing.resolve();
        await publication.promise;
      }
    },
    onStage({ stage }) { stages.push(stage); }
  }).then(value => { finished = true; return value; });
  await observing.promise;
  assert.deepEqual(calls, [["available"], ["prepare", "/repo/worktree"], ["goal", "original-codex"],
    ["pause", "original-codex", "paused"], ["observe", "original-codex"]]);
  observation.resolve();
  await publishing.promise;
  assert.equal(finished, false);
  assert.deepEqual(calls.slice(-3), [["resume", "original-codex"], ["clear"], ["write", "original-codex"]]);
  publication.resolve();
  assert.deepEqual(await selected, { appServerRuntime: runtime, thread: { id: "original-codex" }, threadId: "original-codex" });
  assert.deepEqual(stages, ["runtime", "resume", "identity-metadata"]);
});

test("selection failures preserve the original error and never fall back to a new thread", async () => {
  for (const failed of ["prepare", "goal", "pause", "observe", "resume", "clear", "write"]) {
    const calls = [];
    const failure = new Error(failed);
    const step = name => {
      calls.push(name);
      if (name === failed) throw failure;
    };
    await assert.rejects(ensureCodexAppServerThread({
      provider: {
        async ensureRuntime() { step("runtime"); return {}; },
        async readGoal() { step("goal"); return { goal: { status: "active" } }; },
        async setGoalStatus() { step("pause"); },
        async resumeThread() { step("resume"); return { id: "retained" }; },
        async startThread() { assert.fail("Selection failure must not replace history"); }
      },
      async settings() { step("prepare"); return { threadSettings: {} }; },
      async observeThread() { step("observe"); },
      identity: {
        read: () => "retained",
        pauseGoal: true,
        async clearPause() { step("clear"); },
        async write() { step("write"); }
      }
    }), error => error === failure);
    const order = ["runtime", "prepare", "goal", "pause", "observe", "resume", "clear", "write"];
    assert.deepEqual(calls, order.slice(0, order.indexOf(failed) + 1));
  }
});

test("new selection starts once and rejects a missing native ID before publishing identity", async () => {
  for (const id of ["started", ""]) {
    const calls = [];
    const settings = { model: "selected-model", sessionStartSource: "startup" };
    const selecting = ensureCodexAppServerThread({
      provider: {
        async ensureRuntime() { calls.push("runtime"); return {}; },
        async startThread(input) { calls.push("start"); assert.equal(input, settings); return { id }; },
        async resumeThread() { assert.fail("There is no saved thread to resume"); },
        async readGoal() { assert.fail("There is no saved thread to pause"); }
      },
      async settings() { return { threadStartSettings: settings }; },
      observeThread() { assert.fail("The original new-thread path observes after selection"); },
      identity: { read: () => "", async write(value) { calls.push("write"); assert.equal(value.threadId, id); } }
    });
    if (id) {
      assert.equal((await selecting).threadId, id);
      assert.deepEqual(calls, ["runtime", "start", "write"]);
    } else {
      await assert.rejects(selecting, /Codex app-server did not return a thread id\./u);
      assert.deepEqual(calls, ["runtime", "start"]);
    }
  }
});

test("selection reads the saved pause marker again after resume and retains the fallback native ID", async () => {
  let pauseGoal = true;
  let written;
  const selected = await ensureCodexAppServerThread({
    provider: {
      async ensureRuntime() { return {}; },
      async readGoal() { return { goal: { status: "paused" } }; },
      async setGoalStatus() { assert.fail("An already paused goal stays paused"); },
      async resumeThread() { pauseGoal = false; return {}; }
    },
    async settings() { return { threadSettings: {} }; },
    observeThread() {},
    identity: {
      read: () => "retained",
      get pauseGoal() { return pauseGoal; },
      async clearPause() { assert.fail("The marker changed during native resume"); },
      async write(value) { written = value.threadId; }
    }
  });
  assert.equal(selected.threadId, "retained");
  assert.equal(written, "retained");
});
