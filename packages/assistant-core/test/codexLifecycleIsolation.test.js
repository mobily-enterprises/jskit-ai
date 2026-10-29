import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexConversationCommands } from "../src/server/conversation/codexConversations.js";
import { createCodexHelperThreadLifecycle } from "../src/server/conversation/codexHelperThreads.js";
import { createCodexHelperThreadLedgerOwner } from "../src/server/conversation/codexHelperThreadLedger.js";
import { createCodexRuntimeLifecycle } from "../src/server/conversation/codexRuntimeLifecycle.js";
import { createCodexSessionCleanup } from "../src/server/conversation/codexSessionCleanup.js";
import { createCodexSessionReconciliation } from "../src/server/conversation/codexSessionReconciliation.js";
import {
  CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
  CODEX_HELPER_THREAD_LIFECYCLES,
  createCodexHelperThreadLedger,
  defineCodexHelperThreadRecord,
  helperProfile
} from "./fixtures/codexHelperThreadLedger.js";

// Saved Helper records are legacy native ownership: a record whose session's
// account was removed, or a project ledger that cannot be read, must not keep
// a closing session or project running, and close never reopens to stop.

// Restoration retires a record whose `runtimeDir` is gone.
function savedHelperRecord(root, { runtimeDir = path.join(root, "codex-runtime"), ...overrides } = {}) {
  const now = new Date().toISOString();
  return defineCodexHelperThreadRecord({
    createdAt: now,
    executionProfile: helperProfile(),
    identity: {
      providerId: "codex",
      providerKeyFingerprint: `sha256:${"c".repeat(64)}`,
      runtime: {
        accountIdentitySignature: `sha256:${"a".repeat(64)}`,
        authStateSignature: `v1:${"b".repeat(24)}`,
        endpoint: `unix://${path.join(root, "codex.sock")}`,
        executionMode: "interactive",
        executionContextHash: "c".repeat(12),
        provider: "codex_app_server",
        runtimeDir,
        runtimesHash: "d".repeat(12),
        terminalEnvHash: "e".repeat(12),
        toolHomeSource: "",
        transport: "unix"
      },
      server: { userAgent: "jskit/0.2.2 (lifecycle unit test)" },
      transportId: "codex_app_server"
    },
    lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.READY,
    ownershipId: "ownership-1",
    projectContextRoot: path.join(root, "authority"),
    projectRuntimeRoot: root,
    revision: 1,
    schemaVersion: CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
    sessionId: "session-1",
    threadId: "thread-1",
    turnId: "",
    updatedAt: now,
    workdir: path.join(root, "sessions", "active", "session-1", "source"),
    ...overrides
  });
}

async function withProjectLedger(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-codex-lifecycle-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const helperLifecycle = createCodexHelperThreadLifecycle({
    providerOwner: { providers: new Map() },
    ledgerOwner: createCodexHelperThreadLedgerOwner({
      executionProfile: (value) => structuredClone(value),
      errorPrefix: "vibe64_codex_helper_"
    }),
    applicationName: "Vibe64",
    errorPrefix: "vibe64_"
  });
  return { root, helperLifecycle, ledger: createCodexHelperThreadLedger({ projectRuntimeRoot: root }) };
}

// Record B's account was removed: its provider cannot be prepared again.
function removedAccountRestoration(root, events, { sessionId } = {}) {
  return {
    projectRuntimeRoot: root,
    context: {
      sessionId,
      async prepareRecord(record, ledger) {
        events.push(`prepare:${record.threadId}`);
        return {
          ledger,
          retiring: true,
          async prepareProvider() {
            throw Object.assign(new Error("Connect Codex - Work in AI Accounts first."), { code: "vibe64_codex_helper_ownership_blocked" });
          }
        };
      },
      async publish({ failed }) {
        events.push(`publish:${failed.map((failure) => failure.threadId).join(",")}`);
      }
    }
  };
}

test("closing a Codex session stops its live work even when a saved Helper record cannot be restored", async (t) => {
  const { root, helperLifecycle, ledger } = await withProjectLedger(t);
  await mkdir(path.join(root, "codex-runtime"), { recursive: true });
  await ledger.write(savedHelperRecord(root));
  const events = [];
  const cleanup = createCodexSessionCleanup({
    namespace: (id) => `codex:${id}`,
    runOwner: {},
    providerSessions: { owner: {
      async drainThreadEnvironmentTasks() {},
      async releaseSession(sessionKey) { events.push(`release:${sessionKey}`); return { exitFailure: null }; }
    } },
    sessionClosures: new Map(),
    helperLifecycle,
    journal: { clearSessionRecoveryTimers() {} },
    conversations: {
      codexAppServerConversations: new Map(),
      async closeCodexAppServerConversations(sessionId) { events.push(`conversations:${sessionId}`); }
    },
    debugLog() {},
    debugError: (error) => error?.message
  });
  await cleanup.closeSession("session-1", {
    sessionKey: "codex:session-1",
    async read() {
      return {
        helpers: removedAccountRestoration(root, events, { sessionId: "session-1" }),
        projectRuntimeRoot: root,
        session: {},
        async complete(exitFailure) { events.push(`complete:${exitFailure}`); }
      };
    }
  });
  assert.deepEqual(events, [
    "conversations:session-1",
    "prepare:thread-1",
    "publish:thread-1",
    "release:codex:session-1",
    "complete:null"
  ]);
  assert.equal((await ledger.readAll()).records.length, 1, "the unrestorable record stays for a later connection");
});

test("closing a Codex project stops providers past an unrestorable record and reports it by identity", async (t) => {
  const { root, helperLifecycle, ledger } = await withProjectLedger(t);
  await mkdir(path.join(root, "codex-runtime"), { recursive: true });
  await ledger.write(savedHelperRecord(root));
  await ledger.write(savedHelperRecord(root, { ownershipId: "ownership-2", sessionId: "session-2", threadId: "thread-2",
    runtimeDir: path.join(root, "removed-runtime"),
    workdir: path.join(root, "sessions", "active", "session-2", "source") }));
  const events = [];
  const cleanup = createCodexSessionCleanup({
    namespace: (id) => `codex:${id}`,
    runOwner: {},
    providerSessions: { managed: new Map(), keyFields: () => ({}), owner: {
      async stopProvidersForProject(input) {
        events.push(`stop:${input.projectContextRoot}`);
        return { failed: [], ok: true, projectContextRoot: input.projectContextRoot, providerCount: 1, results: [], stopped: 1 };
      }
    } },
    sessionClosures: new Map(),
    helperLifecycle,
    journal: { clearSessionRecoveryTimers() {} },
    conversations: {
      codexAppServerConversations: new Map([["codex:session-1", new Map()]]),
      async closeCodexAppServerConversations(sessionId) { events.push(`conversations:${sessionId}`); }
    },
    debugLog() {},
    debugError: (error) => error?.message
  });
  const result = await cleanup.closeProject({ projectContextRoot: "/project" }, {
    helpers: Promise.resolve(removedAccountRestoration(root, events))
  });
  assert.deepEqual(events.filter((event) => !event.startsWith("prepare:")),
    ["conversations:session-1", "publish:thread-1", "stop:/project"]);
  assert.deepEqual(events.filter((event) => event.startsWith("prepare:")).sort(), ["prepare:thread-1", "prepare:thread-2"]);
  assert.equal(result.ok, true, "the stop itself succeeded");
  assert.deepEqual(result.helperRestore.failed.map(({ sessionId, threadId }) => ({ sessionId, threadId })),
    [{ sessionId: "session-1", threadId: "thread-1" }]);
  assert.deepEqual((await ledger.readAll()).records.map((record) => record.threadId), ["thread-1"],
    "the record whose runtime is gone is retired; the other stays for a later connection");
});

test("Helper restoration reports an unreadable ledger and a refused notice instead of rejecting", async (t) => {
  const { root, helperLifecycle, ledger } = await withProjectLedger(t);
  await writeFile(ledger.root, "not a directory");
  const unreadable = await helperLifecycle.restoreThreads(root, {
    async prepareRecord() { assert.fail("an unreadable ledger lists no record"); },
    async publish() {}
  });
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.failed.length, 1);
  assert.equal(unreadable.failed[0].projectRuntimeRoot, root);
  await rm(ledger.root, { force: true });

  await mkdir(path.join(root, "codex-runtime"), { recursive: true });
  await ledger.write(savedHelperRecord(root, { runtimeDir: path.join(root, "removed-runtime") }));
  const refused = await helperLifecycle.restoreThreads(root, {
    async prepareRecord(record, recordLedger) { return { ledger: recordLedger, retiring: true }; },
    async publish() {
      throw Object.assign(new Error("Vibe64 session is already archived: session-1"), { code: "vibe64_session_archived" });
    }
  });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.retiredThreadIds, ["thread-1"], "restoration finished before the notice was refused");
  assert.deepEqual(refused.failed.map((failure) => failure.code), ["vibe64_session_archived"]);
  assert.throws(() => helperLifecycle.assertRestored(refused), /already archived/u);
});

test("an assertion over failed restoration names the failing session, thread and cause", async (t) => {
  const { helperLifecycle } = await withProjectLedger(t);
  assert.throws(() => helperLifecycle.assertRestored({
    ok: false,
    projectRuntimeRoot: "/runtime",
    failed: [
      { code: "vibe64_codex_helper_ownership_blocked", error: "Connect Codex - Work in AI Accounts first.", sessionId: "session-1", threadId: "thread-1" },
      { code: "vibe64_codex_helper_ledger_malformed", error: "Record exceeds 65536 bytes.", sessionId: "", threadId: "" }
    ]
  }), (error) => {
    assert.match(error.message, /session session-1, thread thread-1: Connect Codex - Work in AI Accounts first\./u);
    assert.match(error.message, /1 more/u);
    assert.equal(error.details.failed.length, 2);
    return true;
  });
});

function conversationCommands({ context = async () => ({ result: { ok: false, code: "vibe64_session_closing", error: "The session is closing." } }),
  scope = context,
  ensureSessionProvider = async () => assert.fail("closing or deleting must not open a Codex provider"),
  providerSessions = {} } = {}) {
  return createCodexConversationCommands({
    checkpoint: async () => {},
    conversationPreparation: {
      context,
      scope,
      control(_sessionId, input) {
        return { admission: { release() {} }, threadId: String(input.threadId || ""), turnId: "", unavailable: () => null };
      },
      failure(error) { return { ok: false, error: error.message }; },
      isolation: { assertCompatibility() {} }
    },
    errorPrefix: "vibe64_",
    helperLifecycle: { inspectControl: () => undefined },
    namespace: (sessionId) => `codex:${String(sessionId || "").trim()}`,
    providerSessions,
    ensureSessionProvider,
    turnOutcomes: { USER_CANCELLED: "cancelled" }
  });
}

function observingProvider(name, calls, { failStop = false } = {}) {
  return {
    observationFailure: null,
    isAvailable: () => true,
    subscribe() { return () => calls.push(`unsubscribe:${name}`); },
    async readThreadStatus(threadId) { calls.push(`read:${name}:${threadId}`); return { status: { type: "active" } }; },
    async stopThreadForObservationLoss(threadId) {
      calls.push(`stop:${name}:${threadId}`);
      if (failStop) throw new Error("Codex did not confirm that its turn stopped.");
      return { goal: null };
    }
  };
}

test("closing a session stops each Temporary chat through the provider that observes it", async () => {
  const calls = [];
  const providers = new Map([
    ["main", observingProvider("shared", calls)],
    ["main-2", observingProvider("shared", calls, { failStop: true })],
    ["main-3", observingProvider("shared", calls)]
  ]);
  const closedByOwner = observingProvider("closed", calls);
  // The provider owner's own surface: lookups and [key, provider] iteration, no values().
  const ownerProviders = { get: (key) => providers.get(key), keys: () => providers.keys(),
    *entries() { yield* providers.entries(); }, [Symbol.iterator]() { return this.entries(); } };
  const commands = conversationCommands({ providerSessions: { owner: { providers: ownerProviders } } });
  const first = commands.observeCodexConversation("session-1", "chat-1", providers.get("main"));
  const second = commands.observeCodexConversation("session-1", "chat-2", providers.get("main-2"));
  const third = commands.observeCodexConversation("session-1", "chat-3", providers.get("main-3"));
  const detached = commands.observeCodexConversation("session-1", "chat-4", closedByOwner);
  for (const state of [first, second, third, detached]) state.status = "inProgress";

  await assert.rejects(commands.closeCodexAppServerConversations("session-1"), (error) => {
    assert.equal(error.code, "vibe64_codex_conversation_close_failed");
    assert.deepEqual(error.details.failed.map((failure) => failure.conversationId), ["chat-2"]);
    assert.match(error.message, /chat-2/u);
    return true;
  });
  assert.deepEqual(calls.filter((call) => call.startsWith("stop:")), [
    "stop:shared:chat-1", "stop:shared:chat-2", "stop:shared:chat-3"
  ], "one conversation's failure does not skip the others");
  assert.equal(first.status, "interrupted");
  assert.equal(third.status, "interrupted");
  assert.equal(commands.codexAppServerConversation("session-1", "chat-1"), null);
  assert.equal(commands.codexAppServerConversation("session-1", "chat-2"), second, "the unconfirmed one stays for a retry");
  assert.equal(commands.codexAppServerConversation("session-1", "chat-3"), null);
  assert.equal(commands.codexAppServerConversation("session-1", "chat-4"), null,
    "a provider its owner closed is not reconnected to be stopped");
  assert.equal(calls.some((call) => call.includes(":closed:")), false);
  await commands.closeCodexAppServerConversations("session-without-conversations");
});

test("deleting an expired ephemeral helper receipt starts no Codex app-server and still requires verified exit", async () => {
  const calls = [];
  let failRetainedStop = false;
  const sessionKey = "codex:explanation_job";
  // A runtime whose earlier stop could not prove exit, one another provider shares, and another session's.
  const retained = { provider: { name: "retained" }, providerKey: "codex-helper:retained",
    providerOptions: { runtimeDir: "/runtime/retained" }, sessionKey };
  const shared = { provider: { name: "shared" }, providerKey: "codex-helper:shared", providerOptions: {}, sessionKey };
  const elsewhere = { provider: { name: "elsewhere" }, providerKey: "codex-helper:other", providerOptions: {}, sessionKey: "codex:other" };
  const commands = conversationCommands({
    context: async () => assert.fail("an expired helper has no native thread to delete"),
    scope: async () => assert.fail("deleting needs no account, tool home or workdir"),
    providerSessions: { owner: {
      providers: new Map(),
      providerOwners: { get: () => undefined },
      ownedRuntimes: { *values() { yield retained; yield shared; yield elsewhere; } },
      async stopCachedProvidersForSession(key, options) {
        calls.push(`live:${key}:${options.requireStopped}`);
        return { failed: [], ok: true, providerCount: 0, results: [], stopped: 0 };
      },
      runtimeIsShared: (providerKey) => providerKey === shared.providerKey,
      withLifecycle(operation, providerKey, providerOptions) {
        // The owner locks a runtime by its options' runtime directory when it has them.
        calls.push(`lock:${providerKey}:${providerOptions?.runtimeDir || "provider"}`);
        return operation();
      },
      async stopOwnedRuntime(record) {
        calls.push(`retained:${record.provider.name}`);
        if (failRetainedStop) {
          throw Object.assign(new Error("Codex app-server process exit could not be verified."),
            { code: "codex_runtime_exit_unverified", retryable: true });
        }
        return { providerKey: record.providerKey, stopped: true };
      }
    } }
  });
  const scope = { id: "explanation_job", workdir: "/source-that-was-removed" };
  const input = { ephemeral: true, executionProfile: helperProfile(), conversationId: "helper-thread" };
  failRetainedStop = true;
  await assert.rejects(commands.deleteScopedCodexAppServerConversation(scope.id, input, { assistantScope: scope }), (error) => {
    assert.equal(error.code, "codex_runtime_exit_unverified");
    assert.equal(error.retryable, true);
    return true;
  });
  failRetainedStop = false;
  calls.length = 0;
  const result = await commands.deleteScopedCodexAppServerConversation(scope.id, input, { assistantScope: scope });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.conversationExpired, true);
  assert.equal(result.providerExit.stopped, true);
  assert.deepEqual(calls, [`live:${sessionKey}:true`, "lock:codex-helper:retained:/runtime/retained", "retained:retained"],
    "only this session's unshared retained runtime is stopped, under its own runtime lock, and nothing is started");
});

test("an account-change invalidation stops runtimes without reopening saved Helper threads", async () => {
  const calls = [];
  const lifecycle = createCodexRuntimeLifecycle({
    pendingWork: {},
    observer: { eventSubscriptions: new Map() },
    checkManagedConnection: async () => {},
    providerSessions: { managed: new Map(), assertOpen() {}, owner: {
      beginShutdown() {},
      async invalidateRuntimes(input) { calls.push(`invalidate:${input.reason}`); return { failed: [], providerCount: 1, results: [], stopped: 1 }; }
    } },
    helperLifecycle: {
      async restoreThreads() { calls.push("restore"); return { ok: false, failed: [{ error: "stale" }] }; },
      assertRestored() { throw new Error("a stale saved record aborted the invalidation"); }
    },
    captureContext: () => null,
    runInContext: (_context, operation) => operation(),
    debugLog() {},
    debugError: (error) => error?.message
  });
  const result = await lifecycle.invalidateRuntimes({ reason: "account-change" }, {
    enabled: true,
    get helpers() { calls.push("helpers"); return Promise.resolve({ projectRuntimeRoot: "/runtime", context: {} }); }
  });
  assert.equal(result.stopped, 1);
  assert.deepEqual(calls, ["invalidate:account-change"]);
});

test("reconciliation keeps every session and prune retires past one failed provider", async (t) => {
  const { root, helperLifecycle, ledger } = await withProjectLedger(t);
  await ledger.write(savedHelperRecord(root, { runtimeDir: path.join(root, "removed-runtime") }));
  const retired = [];
  const managed = new Map([
    ["provider-a", { sessionId: "stale-a", projectContext: { targetRoot: "/project" } }],
    ["provider-b", { sessionId: "stale-b", projectContext: { targetRoot: "/project" } }]
  ]);
  let generation = 0;
  const reconciliation = createCodexSessionReconciliation({
    readiness: {
      async reconcileThread(sessionId) { return { ok: true, sessionId, status: "reconciled" }; },
      async waitForThreadReconciliations() {}
    },
    recoverSessionObservationLoss: async () => null,
    providerSessions: { assertOpen() {}, managed, owner: { providers: new Map() } },
    helperLifecycle,
    lifecycle: {
      nextReconcileGeneration: () => ++generation,
      get reconcileGeneration() { return generation; },
      reconcileTasks: new Set(),
      async retireProvider(providerKey) {
        retired.push(providerKey);
        if (providerKey === "provider-a") throw Object.assign(new Error("Codex did not confirm deletion."), { retryable: true });
      }
    },
    createRuntime: async () => ({ projectContextRoot: "/project", stateRoot: root, async getSession(id) { return { sessionId: id }; } }),
    namespace: (id) => `codex:${id}`,
    turnState: () => ({ status: "idle" }),
    sessionIdRequiredError: "A session is required.",
    debugLog() {},
    debugError: (error) => error?.message
  });
  const result = await reconciliation.reconcileSessions(["good-a", "good-b"], {}, {
    enabled: true,
    runtimeBusyCode: "vibe64_codex_runtime_busy",
    failureMessage: "Codex reconciliation failed.",
    helperRestoration: () => ({ projectRuntimeRoot: root, context: {
      async prepareRecord(record, recordLedger) { return { ledger: recordLedger, retiring: true }; },
      async publish() {
        throw Object.assign(new Error("Vibe64 session is read-only while its renewal is in progress: renewing"),
          { code: "vibe64_session_renewal_quiesced" });
      }
    } }),
    helperInventory: () => assert.fail("inventory requires a fully restored ledger"),
    async session(sessionId) { return { context: { session: { sessionId } }, thread: {} }; }
  });
  assert.deepEqual(result.results.map((entry) => entry.sessionId), ["good-a", "good-b"]);
  assert.deepEqual(retired, ["provider-a", "provider-b"]);
  assert.deepEqual(result.failed.map((failure) => failure.code || failure.providerKey), [
    "vibe64_session_renewal_quiesced", "provider-a"
  ]);
  assert.equal(result.ok, false);
});
