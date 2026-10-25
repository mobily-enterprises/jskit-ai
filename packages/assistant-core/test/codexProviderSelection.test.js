import assert from "node:assert/strict";
import test from "node:test";
import { createCodexProviderSelection } from "../src/server/conversation/codexProviderSelection.js";

function fixture() {
  const calls = { contexts: [], ensured: [], remembered: [], acquired: [] };
  const provider = {
    ensureRuntime: () => "runtime"
  };
  const providerSessions = {
    managed: new Map(),
    owner: {
      providers: new Map(),
      async ensureSession(connection, threadId) {
        calls.ensured.push({ sessionId: connection.sessionId, threadId });
        return provider;
      },
      async acquireRuntime(input) {
        calls.acquired.push(input.providerKey);
        return input.operation();
      }
    },
    context(sessionId, providerOptions) {
      calls.contexts.push(sessionId);
      return {
        sessionId,
        providerOptions,
        providerKey: `key:${sessionId}`,
        runOwner: {
          runtimeLifecycle: {
            rememberManagedSession: (providerKey, record) => calls.remembered.push({ providerKey, ...record })
          }
        }
      };
    }
  };
  const selection = createCodexProviderSelection({
    providerSessions,
    turnState: () => ({ active: false }),
    helperLifecycle: null,
    helperOwnershipError: null,
    modelCatalogCacheMs: 1,
    errorPrefix: ""
  });
  return { calls, selection };
}

test("session providers and managed records use the normalized session id", async () => {
  const { calls, selection } = fixture();
  await selection.ensureSessionProvider("  s1 ", { mode: "a" }, "thread-1");
  selection.rememberManagedSession(" s1 ", { mode: "a" }, { executionRoot: "/root", workdir: "/work", threadId: "thread-1" });

  assert.deepEqual(calls.ensured, [{ sessionId: "s1", threadId: "thread-1" }]);
  assert.deepEqual(calls.remembered, [{
    providerKey: "key:s1",
    providerOptions: { mode: "a" },
    sessionId: "s1",
    executionRoot: "/root",
    threadId: "thread-1",
    workdir: "/work"
  }]);
  assert.equal(selection.codexAppServerSessionObserverOptions(" s1 ", {}).providerKey, "key:s1");
});

test("the visible terminal runtime acquires the provider key of the normalized session", async () => {
  const { calls, selection } = fixture();
  await selection.codexAppServerRuntimeForVisibleTerminal(" s1 ", {}, { workdir: "" }, {}, async () => ({}));
  assert.deepEqual(calls.ensured, [{ sessionId: "s1", threadId: undefined }]);
  assert.deepEqual(calls.acquired, ["key:s1"]);
  assert.ok(calls.contexts.every(sessionId => sessionId === "s1"));
});
