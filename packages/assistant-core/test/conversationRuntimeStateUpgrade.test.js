import assert from "node:assert/strict";
import test from "node:test";
import { upgradeConversationRuntimeState } from "../src/server/conversation/runtimeStateUpgrade.js";

const configuration = { systemPrompt: "Retained instructions", model: "saved-model" };
const request = { messageId: "uncertain", text: "Authored text", origin: "user", attachments: [{ attachmentId: "file" }],
  at: "2026-10-02T00:00:00.000Z", seen: { "old/user/": "native-version" }, data: { retained: true } };
const bindings = {
  api: undefined,
  codex: { threadId: "saved-thread", workdir: "/workspace", configRoot: "/codex", executionId: "saved-execution" },
  claude: { conversationId: "saved-conversation", workdir: "/workspace", configRoot: "/claude", sent: true },
  opencode: { sessionId: "saved-session", workdir: "/workspace", directory: "/private/session", databasePath: "/shared/opencode.db" }
};
const segment = (engine, extra = {}) => ({ segmentId: `${engine}-segment`, engine, configuration,
  seen: { "old/user/": "native-version" }, ...(bindings[engine] ? { binding: bindings[engine] } : {}), ...extra });
const record = (engine = "claude", extra = {}) => ({
  metadata: { application: { retained: true }, runtime: { ...segment(engine), version: 2, predecessors: [], ...extra } },
  conversationLog: [{ turnId: "old", metadata: { runtime: { engine: "codex", segmentId: "codex-segment", status: "interrupted" } },
    messages: [{ role: "user", text: "Accepted before model selection", messageId: "old-message" }] }]
});

test("offline conversion preserves exact native bindings and authored requests without inventing a prompt", () => {
  const value = record("claude", { predecessors: [segment("codex", { request: structuredClone(request) })] });
  const before = structuredClone(value);
  const result = upgradeConversationRuntimeState(value);
  assert.equal(result.changed, true);
  assert.equal(result.metadata.runtime.version, 3);
  assert.equal(result.metadata.runtime.lastEngine, "codex", "Selection alone is not delivery");
  assert.deepEqual(result.metadata.application, before.metadata.application);
  assert.deepEqual(result.metadata.runtime.binding, before.metadata.runtime.binding);
  assert.deepEqual(result.metadata.runtime.seen, before.metadata.runtime.seen);
  assert.deepEqual(result.metadata.runtime.predecessors[0], { ...before.metadata.runtime.predecessors[0],
    request: { ...request, inspectionOnly: true, threadId: "saved-thread" } });
  assert.equal(Object.hasOwn(result.metadata.runtime.predecessors[0].request, "message"), false);
  assert.equal(Object.hasOwn(result.metadata.runtime.predecessors[0].request, "attempted"), false);
  assert.match(result.warnings[0], /not reconstructed.*not be replayed/);
  assert.deepEqual(value, before, "The transformer does not mutate its source");
});

test("pre-runtime transcripts gain no binding and current converted records are no-ops", () => {
  const metadata = { application: "retained" };
  assert.deepEqual(upgradeConversationRuntimeState({ metadata, conversationLog: [] }), { metadata, changed: false, warnings: [] });
  const value = record("codex", { request: structuredClone(request) });
  const first = upgradeConversationRuntimeState(value);
  const second = upgradeConversationRuntimeState({ ...value, metadata: first.metadata });
  assert.equal(second.changed, false);
  assert.equal(second.metadata, first.metadata);
  assert.deepEqual(second.warnings, []);
});

test("unfinished replacements retain their operation and inspect the destination's exact identity", () => {
  const replacement = { ...segment("opencode"), request: { operationId: "selection", expectedSegmentId: "claude-segment", operation: "select" },
    reason: "engine-change", submission: structuredClone(request), continuity: "Retained context", supersededTurns: [] };
  const value = record("claude", { replacement });
  const result = upgradeConversationRuntimeState(value);
  assert.deepEqual(result.metadata.runtime.replacement, { ...replacement,
    submission: { ...request, inspectionOnly: true, threadId: "saved-session" } });
  assert.deepEqual(value.metadata.runtime.replacement, replacement);
});

test("replacement preparation timestamps stay on the existing operation without backfilling older records", () => {
  for (const preparation of [{}, { preparedAt: "2026-10-03T00:00:00.000Z" }]) {
    const value = record("claude", { replacement: { ...segment("claude", { segmentId: "successor" }),
      request: { operationId: "renewal", expectedSegmentId: "claude-segment", operation: "replace" },
      reason: "renewal", ...preparation }, predecessors: [segment("codex", preparation)] });
    const before = structuredClone(value);
    const result = upgradeConversationRuntimeState(value);
    assert.deepEqual(result.metadata.runtime.replacement, before.metadata.runtime.replacement);
    assert.deepEqual(result.metadata.runtime.predecessors, before.metadata.runtime.predecessors);
    assert.equal(upgradeConversationRuntimeState({ ...value, metadata: result.metadata }).changed, false);
    assert.deepEqual(value, before);
  }
  for (const extra of [{ replacement: { ...segment("claude"), preparedAt: 1 } },
    { predecessors: [segment("codex", { preparedAt: null })] }]) {
    assert.throws(() => upgradeConversationRuntimeState(record("claude", extra)), { code: "conversation_runtime_upgrade_unavailable" });
  }
});

test("private OpenCode database bindings block preflight in current, retained and replacement state", () => {
  const unsupported = segment("opencode", { binding: { ...bindings.opencode, databasePath: undefined } });
  for (const value of [record("opencode", unsupported), record("claude", { predecessors: [unsupported] }),
    record("claude", { replacement: { ...unsupported, request: { operationId: "pending" } } })]) {
    const before = structuredClone(value);
    assert.throws(() => upgradeConversationRuntimeState(value), /complete offline native-history upgrade.*database was not changed/);
    assert.deepEqual(value, before);
  }
});

test("unfinished historical Undo journals block offline conversion while completed markers remain intact", () => {
  for (const version of [2, 3]) {
    for (const patch of [{ reason: "rewind" }, { request: { operationId: "old", reason: "rewind" } },
      { request: { operationId: "old", throughTurnId: null } }, { supersededTurns: ["old"] }]) {
      const value = record("api", { version, lastEngine: "api", replacement: { ...segment("api"),
        request: { operationId: "old", reason: "renewal" }, reason: "renewal", ...patch } });
      const before = structuredClone(value);
      assert.throws(() => upgradeConversationRuntimeState(value), /unfinished Undo.*offline.*no history was changed/);
      assert.deepEqual(value, before);
    }
  }
  const completed = record("api", { version: 3, lastEngine: "api", predecessors: [segment("api", {
    segmentId: "previous", successorId: "api-segment", replacement: { operationId: "done", reason: "rewind", throughTurnId: null }
  })] });
  completed.conversationLog[0].metadata.runtime.supersededBy = "api-segment";
  const before = structuredClone(completed);
  assert.deepEqual(upgradeConversationRuntimeState(completed), { metadata: completed.metadata, changed: false, warnings: [] });
  assert.deepEqual(completed, before);
});

test("unknown formats and ambiguous pending identities fail without guessing or modifying input", () => {
  for (const value of [record("codex", { version: 1 }),
    record("codex", { binding: { ...bindings.codex, threadId: "" }, request: structuredClone(request) }),
    record("codex", { request: { ...request, message: "Unknown partially converted prompt" } }),
    record("codex", { request: { ...request, attachmentManifest: "Unknown partially converted paths" } })]) {
    const before = structuredClone(value);
    assert.throws(() => upgradeConversationRuntimeState(value), { code: "conversation_runtime_upgrade_unavailable" });
    assert.deepEqual(value, before);
  }
});

test("API reservations keep their admission contract and unattributed history is not native delivery proof", () => {
  const value = record("api", { request: structuredClone(request) });
  value.conversationLog[0].metadata = { application: "legacy" };
  const result = upgradeConversationRuntimeState(value);
  assert.equal(result.metadata.runtime.lastEngine, "");
  assert.deepEqual(result.metadata.runtime.request, request);
  assert.deepEqual(result.warnings, []);
});

test("current journals distinguish an unsent reservation from a frozen attempted native prompt", () => {
  const reserved = record("codex", { version: 3, lastEngine: "codex", binding: { ...bindings.codex, threadId: "" },
    request: { ...request, attempted: false } });
  assert.equal(upgradeConversationRuntimeState(reserved).changed, false);
  const frozen = record("codex", { version: 3, lastEngine: "codex", request: { ...request, attempted: true,
    threadId: "saved-thread", message: "The exact rendered native prompt", displayMessage: request.text,
    displayAttachments: request.attachments, attachmentIds: ["file"], contextText: "The exact private history",
    contextAttachments: [{ attachmentId: "earlier-file" }], attachmentManifest: "\n\nAttached files:\n@file \"name\": \"/authorized/file\"" } });
  assert.equal(upgradeConversationRuntimeState(frozen).changed, false);
  for (const patch of [{ attempted: undefined }, { message: undefined }, { threadId: "another-thread" },
    { inspectionOnly: false }, { contextAttachments: undefined }, { attachmentManifest: null }]) {
    assert.throws(() => upgradeConversationRuntimeState({ ...frozen,
      metadata: { ...frozen.metadata, runtime: { ...frozen.metadata.runtime,
        request: { ...frozen.metadata.runtime.request, ...patch } } } }), { code: "conversation_runtime_upgrade_unavailable" });
  }
});
