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

function codexRetirementRecord() {
  const value = record("codex", { version: 3, lastEngine: "codex",
    continuity: "Retained discussion", continuityAttachments: [{ attachmentId: "earlier" }],
    binding: { ...bindings.codex, accountIdentity: "retained-account", toolSchemaIdentity: "a".repeat(64),
      run: { turnId: "retained-native-turn", status: "running" }, goal: { status: "active", objective: "Retained native goal" } },
    predecessors: [segment("claude", { segmentId: "earlier-segment" })] });
  value.metadata.application.effects = [{ toolCallId: "already-invoked", status: "unknown" }];
  return { ...value, retirement: { operationId: "retire-old-manifest", successorSegmentId: "inert-successor",
    expectedSegmentId: value.metadata.runtime.segmentId, expectedThreadId: value.metadata.runtime.binding.threadId,
    expectedToolSchemaIdentity: value.metadata.runtime.binding.toolSchemaIdentity,
    workdir: value.metadata.runtime.binding.workdir, configRoot: value.metadata.runtime.binding.configRoot } };
}

test("explicit Codex retirement only transforms metadata and preserves the exact predecessor and history", () => {
  const value = codexRetirementRecord();
  const before = structuredClone(value);
  const { retirement, ...withoutRetirement } = value;
  const unchanged = upgradeConversationRuntimeState(withoutRetirement);
  assert.equal(unchanged.changed, false, "Known metadata alone must not activate retirement");
  assert.equal(unchanged.metadata, value.metadata);
  assert.deepEqual(unchanged.warnings, []);

  const result = upgradeConversationRuntimeState(value);
  const old = before.metadata.runtime;
  const current = result.metadata.runtime;
  assert.equal(result.changed, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.metadata.application, before.metadata.application);
  assert.deepEqual(current.predecessors[0], old.predecessors[0]);
  assert.deepEqual(current.predecessors[1], { segmentId: old.segmentId, engine: old.engine,
    configuration: old.configuration, binding: old.binding, seen: old.seen,
    continuity: old.continuity, continuityAttachments: old.continuityAttachments, request: undefined,
    successorId: retirement.successorSegmentId, replacement: { operationId: retirement.operationId,
      expectedSegmentId: old.segmentId, engine: "codex", configuration: old.configuration,
      retireNative: true, operation: "select" } });
  assert.deepEqual(current.binding, { threadId: "", workdir: old.binding.workdir,
    configRoot: old.binding.configRoot, executionId: "" });
  assert.equal(current.segmentId, retirement.successorSegmentId);
  assert.equal(current.engine, "codex");
  assert.equal(current.version, 3);
  assert.deepEqual(current.configuration, old.configuration);
  assert.deepEqual(current.seen, {});
  assert.equal(current.lastEngine, "");
  assert.equal(current.continuity, undefined);
  assert.deepEqual(current.continuityAttachments, []);
  assert.equal(Object.hasOwn(current, "request"), false);
  assert.equal(Object.hasOwn(current, "replacement"), false);
  assert.equal(Object.hasOwn(current.predecessors[1], "preparedAt"), false);
  assert.deepEqual(value, before, "Native activity and effect facts are retained, not certified or mutated");
  assert.deepEqual(upgradeConversationRuntimeState(structuredClone(before)), result,
    "Verified before metadata and stable IDs yield the same pure result");
  const repeated = { ...before, metadata: result.metadata };
  const repeatedBefore = structuredClone(repeated);
  assert.throws(() => upgradeConversationRuntimeState(repeated), { code: "conversation_runtime_upgrade_unavailable" });
  assert.deepEqual(repeated, repeatedBefore, "A converted tuple is not silently retired a second time");
});

test("explicit Codex retirement refuses malformed IDs, changed identity and unresolved metadata without mutation", () => {
  const cases = [
    ["numeric operation ID", value => { value.retirement.operationId = 1; }],
    ["numeric successor ID", value => { value.retirement.successorSegmentId = 1; }],
    ["unknown input field", value => { value.retirement.idle = true; }],
    ["changed segment", value => { value.retirement.expectedSegmentId = "other-segment"; }],
    ["changed native thread", value => { value.retirement.expectedThreadId = "other-thread"; }],
    ["changed tool schema", value => { value.retirement.expectedToolSchemaIdentity = "b".repeat(64); }],
    ["changed workdir", value => { value.retirement.workdir = "/other-workspace"; }],
    ["changed config root", value => { value.retirement.configRoot = "/other-account"; }],
    ["relative path", value => { value.retirement.workdir = "workspace"; }],
    ["current successor", value => { value.retirement.successorSegmentId = value.metadata.runtime.segmentId; }],
    ["retained successor", value => { value.retirement.successorSegmentId = "earlier-segment"; }],
    ["reserved successor", value => { value.metadata.runtime.predecessors[0].successorId = value.retirement.successorSegmentId; }],
    ["used operation", value => { value.metadata.runtime.predecessors[0].replacement = { operationId: value.retirement.operationId }; }],
    ["missing runtime", value => { delete value.metadata.runtime; }],
    ["old runtime version", value => { value.metadata.runtime.version = 2; }],
    ["other engine", value => { value.metadata.runtime.engine = "claude"; value.metadata.runtime.binding = bindings.claude; }],
    ["pending delivery", value => { value.metadata.runtime.request = { ...request, attempted: false }; }],
    ["pending replacement", value => { value.metadata.runtime.replacement = { ...segment("codex"), segmentId: "pending",
      request: { operationId: "pending-selection", expectedSegmentId: value.metadata.runtime.segmentId, operation: "select" } }; }],
    ["unfinished Undo", value => { value.metadata.runtime.replacement = { ...segment("codex"), reason: "rewind" }; }]
  ];
  for (const [reason, mutate] of cases) {
    const value = codexRetirementRecord();
    mutate(value);
    const before = structuredClone(value);
    assert.throws(() => upgradeConversationRuntimeState(value), { code: "conversation_runtime_upgrade_unavailable" }, reason);
    assert.deepEqual(value, before, reason);
  }
});
