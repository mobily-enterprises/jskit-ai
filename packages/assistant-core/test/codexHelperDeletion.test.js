import assert from "node:assert/strict";
import test from "node:test";
import {
  codexAppServerThreadHasReadableHistory,
  deleteCodexAppServerThread,
  deleteCodexAppServerHelperThread
} from "../src/server/conversation/codexProvider.js";

function invalidRequest(method) {
  return Object.assign(new Error(`${method} rejected`), { code: -32600, method });
}

// The original Public lifecycle tests retain durable receipts, authority and
// retry assertions. These cases cover the native protocol branch moved here.
test("Helper deletion awaits the exact active-turn interruption before confirming deletion", async () => {
  const calls = [];
  const started = Promise.withResolvers();
  const interrupted = Promise.withResolvers();
  const deleted = { id: "helper-thread" };
  const pending = deleteCodexAppServerHelperThread({
    threadId: "helper-thread",
    turnId: "helper-turn",
    provider: {
      async interruptTurn(threadId, turnId) {
        calls.push(["interrupt", threadId, turnId]);
        started.resolve();
        await interrupted.promise;
      },
      async deleteThread(threadId) { calls.push(["delete", threadId]); return deleted; },
      async readThread() { assert.fail("A confirmed native deletion does not need an absence probe"); }
    }
  });
  await started.promise;
  assert.deepEqual(calls, [["interrupt", "helper-thread", "helper-turn"]]);
  interrupted.resolve();
  assert.deepEqual(await pending, {
    deleted: true, interrupted: true, ok: true, result: deleted,
    status: "deleted", threadId: "helper-thread", turnId: "helper-turn", interruptError: null
  });
  assert.deepEqual(calls, [["interrupt", "helper-thread", "helper-turn"], ["delete", "helper-thread"]]);
});

test("Helper deletion retains interruption failure while allowing confirmed thread removal", async () => {
  const failure = new Error("Interruption unavailable");
  const result = await deleteCodexAppServerHelperThread({
    threadId: "helper-thread",
    turnId: "helper-turn",
    provider: {
      async interruptTurn() { throw failure; },
      async deleteThread(threadId) { assert.equal(threadId, "helper-thread"); return {}; }
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.deleted, true);
  assert.equal(result.interrupted, false);
  assert.equal(result.interruptError, failure);
});

test("Helper deletion accepts invalid-request absence only after the original read-back check", async () => {
  const calls = [];
  const result = await deleteCodexAppServerHelperThread({
    threadId: "helper-thread",
    provider: {
      async deleteThread(id) { calls.push(["delete", id]); throw invalidRequest("thread/delete"); },
      async readThread(id) { calls.push(["read", id]); throw invalidRequest("thread/read"); }
    }
  });
  assert.deepEqual(calls, [["delete", "helper-thread"], ["read", "helper-thread"]]);
  assert.deepEqual(result, {
    deleted: false, interrupted: false, ok: true, status: "notFound",
    threadId: "helper-thread", turnId: "", interruptError: null
  });
});

test("Helper deletion keeps unproven native failures instead of acknowledging cleanup", async () => {
  for (const outcome of ["readable", "read-failure", "wrong-delete-method", "delete-failure"]) {
    let reads = 0;
    const failure = outcome === "delete-failure" ? new Error("Delete transport disconnected")
      : invalidRequest(outcome === "wrong-delete-method" ? "thread/resume" : "thread/delete");
    const result = await deleteCodexAppServerHelperThread({
      threadId: "helper-thread",
      provider: {
        async deleteThread() { throw failure; },
        async readThread() {
          reads += 1;
          if (outcome === "read-failure") throw new Error("Read transport disconnected");
          return { id: "helper-thread", turns: [] };
        }
      }
    });
    assert.equal(result.ok, false, outcome);
    assert.equal(result.error, failure, outcome);
    assert.equal(result.interruptError, null, outcome);
    assert.equal(reads, ["readable", "read-failure"].includes(outcome) ? 1 : 0, outcome);
    assert.equal("deleted" in result, false, outcome);
  }
});

test("Helper deletion rejects unavailable or unconfirmed native deletion without a history fallback", async () => {
  for (const value of [undefined, null, [], false]) {
    const result = await deleteCodexAppServerHelperThread({
      threadId: "helper-thread",
      provider: {
        async deleteThread() { return value; },
        async readThread() { assert.fail("An invalid result is not native proof of absence"); }
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "codex_helper_thread_delete_unconfirmed");
    assert.equal(result.error.message, "Codex app-server returned an invalid thread deletion result.");
  }
  const unavailable = await deleteCodexAppServerHelperThread({
    provider: {}, threadId: "helper-thread", turnId: "helper-turn"
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.message, "Codex provider cannot delete a helper thread.");
  assert.equal(unavailable.interruptError.message, "Codex provider cannot interrupt an active helper turn.");
});

test("the original readable-history classifier preserves normalization and unrelated errors", async () => {
  const calls = [];
  assert.equal(await codexAppServerThreadHasReadableHistory({
    async readThread(id) { calls.push(id); return { turns: [] }; }
  }, " helper-thread "), true);
  assert.deepEqual(calls, ["helper-thread"]);
  assert.equal(await codexAppServerThreadHasReadableHistory({
    async readThread() { throw invalidRequest("thread/read"); }
  }, "helper-thread"), false);
  const failure = invalidRequest("thread/resume");
  await assert.rejects(codexAppServerThreadHasReadableHistory({
    async readThread() { throw failure; }
  }, "helper-thread"), error => error === failure);
});

test("direct native deletion validates its result without interrupting or reading history", async () => {
  const calls = [];
  const deleted = { id: "helper-thread" };
  const provider = {
    async deleteThread(threadId) { calls.push(threadId); return deleted; },
    async interruptTurn() { assert.fail("Compensation has no active turn to interrupt"); },
    async readThread() { assert.fail("Direct deletion does not substitute an absence proof"); }
  };
  assert.equal(await deleteCodexAppServerThread({ provider, threadId: "helper-thread" }), deleted);
  assert.deepEqual(calls, ["helper-thread"]);
  for (const value of [undefined, null, [], false]) {
    await assert.rejects(deleteCodexAppServerThread({
      provider: { ...provider, async deleteThread() { return value; } }, threadId: "helper-thread"
    }), { message: "Codex app-server returned an invalid thread deletion result." });
  }
});

test("direct native deletion preserves invalid-request and transport errors without read-back", async () => {
  for (const failure of [invalidRequest("thread/delete"), new Error("Delete transport disconnected")]) {
    await assert.rejects(deleteCodexAppServerThread({
      threadId: "helper-thread",
      provider: {
        async deleteThread(threadId) { assert.equal(threadId, "helper-thread"); throw failure; },
        async interruptTurn() { assert.fail("Compensation must not interrupt"); },
        async readThread() { assert.fail("Compensation must retain the original native failure"); }
      }
    }), error => error === failure);
  }
});
