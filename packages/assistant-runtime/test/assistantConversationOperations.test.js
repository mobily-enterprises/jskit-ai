import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createConversationRuntime, createConversationTranscript, createFileConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { actionIds } from "../src/server/actionIds.js";
import { createAssistantActions } from "../src/server/actions.js";
import { registerRoutes } from "../src/server/registerRoutes.js";

const config = {
  surfaceDefinitions: {
    home: { enabled: true, requiresWorkspace: false },
    admin: { enabled: true, requiresWorkspace: true }
  },
  assistantSurfaces: {
    home: { settingsSurfaceId: "home", configScope: "global" },
    admin: { settingsSurfaceId: "admin", configScope: "workspace" }
  }
};

async function fixture(t, { workspace = false, conversationDataSchema = null, applicationChoices = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "assistant-operations-"));
  const trustedWorkspace = { id: "workspace-one", slug: "trusted-workspace" };
  const surfaceId = workspace ? "admin" : "home";
  const context = {
    actor: { id: "owner" }, surface: surfaceId, channel: "api",
    requestMeta: workspace ? { resolvedWorkspaceContext: { workspace: trustedWorkspace } } : {}
  };
  const requests = [];
  const dispatched = [Promise.withResolvers(), Promise.withResolvers()];
  const scopeInputs = [];
  const knownIds = new Set(["chat:one", "chat:two"]);
  const access = { allowed: true };
  const storage = createFileConversationStorage({ directory });
  const runtime = createConversationRuntime({
    storage,
    authorize: ({ context: actor, conversationId }) => access.allowed && actor?.actor?.id === "owner" && knownIds.has(conversationId) &&
      (!workspace || actor.workspace?.id === trustedWorkspace.id),
    connections: {
      async resolve({ context: actor }) {
        assert.equal(actor.actor.id, "owner");
        return { providerId: "test", model: "exact-model", sdkPackage: "@ai-sdk/openai-compatible",
          apiKey: "test", baseURL: "http://test.invalid/v1" };
      }
    },
    fetch: (_url, request) => {
      requests.push(request);
      dispatched[requests.length - 1]?.resolve();
      return new Promise((_resolve, reject) => {
        request.signal.throwIfAborted();
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
      });
    }
  });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const conversations = new Map();
  for (const id of knownIds) {
    conversations.set(id, await runtime.open({
      id,
      context: workspace ? { ...context, workspace: trustedWorkspace } : context,
      configuration: { systemPrompt: "Answer briefly.", integrationId: "assistant" }
    }));
  }
  const workspaceScopeSupport = workspace ? {
    params: { schema: createSchema({ workspaceSlug: { type: "string", required: true } }), mode: "patch" },
    buildInputFromRouteParams(params) { return { workspaceSlug: params.workspaceSlug }; },
    resolveWorkspace(actor, input) {
      scopeInputs.push(input);
      return actor.requestMeta.resolvedWorkspaceContext?.workspace;
    }
  } : null;
  const options = { config, conversationRuntime: applicationChoices ? {
    async open(input) {
      const conversation = await runtime.open(input);
      return { ...conversation, async select({ modelChoice }) {
        assert.equal(modelChoice, "alternate");
        const current = await conversation.read();
        return conversation.select({ operationId: "select-alternate", expectedSegmentId: current.segmentId,
          engine: "api", configuration: { ...current.configuration, integrationId: "alternate", model: "next-model" } });
      }, async replace({ operationId, expectedSegmentId, choice }) {
        assert.equal(choice, "renew");
        return conversation.replace({ operationId, expectedSegmentId, reason: "renewal",
          briefing: "The server's approved continuity briefing." });
      } };
    }
  } : runtime, workspaceScopeSupport, conversationDataSchema,
  ...(applicationChoices ? {
    conversationConfigurationSchema: createSchema({ effort: { type: "string", enum: ["low", "high"], required: true } }),
    conversationSelectionSchema: createSchema({ modelChoice: { type: "string", enum: ["alternate"], required: true } }),
    conversationReplacementSchema: createSchema({
      operationId: { type: "string", required: true, minLength: 1, maxLength: 128 },
      expectedSegmentId: { type: "string", required: true, minLength: 1, maxLength: 128 },
      choice: { type: "string", enum: ["renew"], required: true }
    })
  } : {}) };
  const catalogue = createActionCatalogue();
  catalogue.register({ contributorId: "test.assistant", domain: "assistant", actions: createAssistantActions(options) });
  const router = createRouter();
  registerRoutes(router, options);
  const routes = router.list();
  const basePath = workspace
    ? "/api/w/:workspaceSlug/assistant/:surfaceId/conversations/:conversationId"
    : "/api/assistant/:surfaceId/conversations/:conversationId";

  async function invoke(method, suffix = "", { id = "chat:one", messageId = "first", body = {}, query = {}, actor = context, header = surfaceId } = {}) {
    const route = routes.find(candidate => candidate.method === method && candidate.path === basePath + suffix);
    assert.ok(route, `Missing ${method} ${basePath + suffix}`);
    const raw = new EventEmitter();
    const reply = { code(status) { this.status = status; return this; }, send(payload) { this.payload = payload; } };
    await route.handler({
      raw,
      headers: { "x-jskit-surface": header },
      input: { params: { conversationId: id, messageId, surfaceId, workspaceSlug: trustedWorkspace.slug }, body, query },
      executeAction({ actionId, surface, input }) {
        return catalogue.execute({ actionId, input, context: { ...actor, surface } });
      }
    }, reply);
    return { ...reply, raw };
  }

  return { invoke, requests, dispatched, conversations, directory, storage, scopeInputs, context, catalogue, routes, options, access };
}

test("conversation read queries preserve original chronological pages and current authorization", async t => {
  const f = await fixture(t, { workspace: true });
  const transcript = createConversationTranscript({ storage: f.storage });
  for (let index = 1; index <= 3; index += 1) {
    await transcript.writeConversationUserMessage("chat:one", { messageId: `question-${index}`, text: `Question ${index}` });
    await transcript.writeConversationAssistantMessage("chat:one", { messageId: `answer-${index}`, text: `Answer ${index}` });
  }
  const full = (await f.invoke("GET")).payload;
  assert.equal(full.conversationLog.length, 3);
  assert.equal(Object.hasOwn(full, "pagination"), false, "An ordinary read retains its full-history default");
  const latest = (await f.invoke("GET", "", { query: {
    limit: "2", conversationId: "chat:two", workspaceSlug: "forged-workspace",
    actor: { id: "another-person" }, context: { actor: { id: "another-person" } }, host: { nativeTools: true }
  } })).payload;
  assert.deepEqual(latest.conversationLog, full.conversationLog.slice(1));
  assert.deepEqual(latest.pagination, {
    beforeTurnId: "", count: 2, hasMoreBefore: true, limit: 2,
    newestTurnId: full.conversationLog[2].turnId,
    nextBeforeTurnId: full.conversationLog[1].turnId,
    oldestTurnId: full.conversationLog[1].turnId, totalTurnCount: 3
  });
  const older = (await f.invoke("GET", "", { query: { beforeTurnId: latest.pagination.nextBeforeTurnId, limit: "2" } })).payload;
  assert.deepEqual(older.conversationLog, full.conversationLog.slice(0, 1));
  assert.equal(older.pagination.hasMoreBefore, false);
  assert.equal(older.pagination.nextBeforeTurnId, "");
  assert.deepEqual((await f.invoke("GET")).payload.conversationLog, full.conversationLog);
  const other = (await f.invoke("GET", "", { id: "chat:two", query: { limit: "2" } })).payload;
  assert.deepEqual(other.conversationLog, []);
  assert.equal(other.pagination.totalTurnCount, 0);
  await assert.rejects(f.invoke("GET", "", { query: { limit: "2" }, actor: { ...f.context, actor: { id: "another-person" } } }),
    { code: "conversation_forbidden" });
  await assert.rejects(f.invoke("GET", "", { query: { limit: "2" }, id: "unknown" }), { code: "conversation_forbidden" });
  await assert.rejects(f.invoke("GET", "", { query: { beforeTurnId: { path: "/private/history" }, limit: "2" } }),
    { code: "ACTION_VALIDATION_FAILED" });
  assert.ok(f.scopeInputs.every(input => input.workspaceSlug === "trusted-workspace"));
  assert.equal(f.requests.length, 0, "Reading saved pages never starts inference");
  f.access.allowed = false;
  await assert.rejects(f.invoke("GET", "", { query: { beforeTurnId: latest.pagination.nextBeforeTurnId, limit: "2" } }),
    { code: "conversation_forbidden" });
});

test("declared conversation configuration and selection preserve host policy and reauthorize every operation", async t => {
  const f = await fixture(t, { applicationChoices: true, workspace: true });
  const before = (await f.invoke("GET")).payload;
  const operations = [
    ["PATCH", "/configuration", { configuration: { effort: "low" } }, "configuration"],
    ["POST", "/selection", { selection: { modelChoice: "alternate" } }, "selection"]
  ];
  for (const [method, suffix, body, field] of operations) {
    await assert.rejects(f.invoke(method, suffix, { body, actor: { ...f.context, actor: { id: "another-person" } } }),
      { code: "conversation_forbidden" });
    await assert.rejects(f.invoke(method, suffix, { body, id: "unknown" }), { code: "conversation_forbidden" });
    for (const extra of [{ engine: "codex" }, { host: { nativeTools: true } },
      { systemPrompt: "Replace server instructions" }, { context: f.context }, { actor: f.context.actor }]) {
      await assert.rejects(f.invoke(method, suffix, { body: { [field]: { ...body[field], ...extra } } }),
        { code: "ACTION_VALIDATION_FAILED" });
    }
  }
  const configured = await f.invoke("PATCH", "/configuration", { body: {
    configuration: { effort: "low" }, context: { actor: { id: "another-person" } },
    engine: "codex", host: { nativeTools: true }
  } });
  assert.equal(configured.status, 200);
  assert.deepEqual(configured.payload, { systemPrompt: "Answer briefly.", integrationId: "assistant", effort: "low" });
  const selected = await f.invoke("POST", "/selection", { body: {
    selection: { modelChoice: "alternate" }, configuration: { systemPrompt: "Injected" }, engine: "codex"
  } });
  assert.equal(selected.status, 200);
  assert.equal(selected.payload.operationId, "select-alternate");
  assert.equal(selected.payload.segmentId, before.segmentId,
    "Selecting another authorized API model retains the same conversation segment");
  const current = (await f.invoke("GET")).payload;
  assert.equal(current.engine, "api");
  assert.deepEqual(current.configuration, { systemPrompt: "Answer briefly.", integrationId: "alternate", model: "next-model", effort: "low" });
  assert.deepEqual(current.conversationLog, before.conversationLog);
  assert.equal((await f.invoke("GET", "", { id: "chat:two" })).payload.configuration.integrationId, "assistant");
  assert.equal(f.requests.length, 0, "Configuration and selection do not perform inference");
  assert.ok(f.scopeInputs.every(input => input.workspaceSlug === "trusted-workspace"));
  f.access.allowed = false;
  for (const [method, suffix, body] of operations) {
    await assert.rejects(f.invoke(method, suffix, { body }), { code: "conversation_forbidden" });
  }
});

test("file-backed conversation routes return admission receipts and cancel one conversation independently", async t => {
  const f = await fixture(t);
  assert.deepEqual(f.catalogue.listDefinitions().map(({ id }) => id), [
    actionIds.conversationRead, actionIds.conversationSend, actionIds.conversationCancel, actionIds.conversationSubscribe,
    actionIds.conversationInspectDelivery, actionIds.conversationGoalRead, actionIds.conversationGoalUpdate
  ]);
  assert.equal(f.routes.length, 6, "A supplied runtime does not register the old chat or optional settings routes");
  const initial = await f.invoke("GET");
  assert.equal(initial.status, 200);
  assert.equal(initial.payload.id, "chat:one");
  assert.equal(initial.payload.status, "ready");

  const first = await f.invoke("POST", "/messages", { body: { messageId: "first", text: "First question" } });
  const second = await f.invoke("POST", "/messages", { id: "chat:two", body: { messageId: "second", text: "Second question" } });
  assert.equal(first.status, 202);
  assert.equal(first.payload.status, "accepted");
  assert.equal(second.payload.status, "accepted");
  await Promise.all(f.dispatched.map(({ promise }) => promise));
  first.raw.emit("close");
  assert.equal(f.requests[0].signal.aborted, false, "HTTP close does not cancel admitted work");
  const during = await f.invoke("GET");
  assert.equal(during.payload.status, "working");
  assert.equal(during.payload.conversationLog[0].user.messageId, "first");
  assert.equal(during.payload.conversationLog[0].assistant, null);
  const repeat = await f.invoke("POST", "/messages", { body: { messageId: "first", text: "First question" } });
  assert.equal(repeat.payload.duplicate, true);
  assert.equal(repeat.payload.turnId, first.payload.turnId);
  assert.equal(f.requests.length, 2);

  const canceled = await f.invoke("POST", "/cancel");
  assert.deepEqual(canceled.payload, { stopped: true });
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[1].signal.aborted, false);
  assert.equal((await f.invoke("GET", "", { id: "chat:two" })).payload.status, "working");
  assert.equal((await f.invoke("GET")).payload.conversationLog[0].metadata.runtime.status, "cancelled");
  const inspected = await f.invoke("POST", "/deliveries/:messageId/inspect", { body: { text: "Do not submit this body" } });
  assert.deepEqual(inspected.payload, { status: "accepted", messageId: "first", turnId: first.payload.turnId, duplicate: true });
  assert.equal(inspected.status, 200);
  const unknown = await f.invoke("POST", "/deliveries/:messageId/inspect", { messageId: "unknown-message" });
  assert.deepEqual(unknown.payload, { status: "unknown", messageId: "unknown-message" });
  assert.equal(f.requests.length, 2, "Receipt inspection never submits another model request");
  assert.equal((await readdir(f.directory)).length, 2, "Only the host's two conversation records are persisted");
});

test("conversation routes keep authenticated ownership and reject unknown identities", async t => {
  const f = await fixture(t);
  const other = { ...f.context, actor: { id: "other-user" } };
  for (const [method, suffix] of [["GET", ""], ["POST", "/messages"], ["POST", "/cancel"],
    ["POST", "/deliveries/:messageId/inspect"], ["GET", "/goal"], ["POST", "/goal"]]) {
    await assert.rejects(f.invoke(method, suffix, { actor: other, body: {
      action: "set", expectedSegmentId: "segment", objective: "A goal", messageId: "forged", text: "A forged request", actor: f.context.actor, context: f.context,
      host: { nativeTools: true }, configuration: { systemPrompt: "Override" }, engine: "codex"
    } }), { code: "conversation_forbidden" });
    await assert.rejects(f.invoke(method, suffix, { id: "unknown", body: { messageId: "unknown", text: "No conversation", action: "set", expectedSegmentId: "segment", objective: "A goal" } }),
      { code: "conversation_forbidden" });
  }
  await assert.rejects(f.invoke("GET", "", { header: "admin" }), { status: 403 });
  await assert.rejects(f.invoke("GET", "", { actor: { ...f.context, actor: null } }), { status: 401 });
  assert.equal(f.requests.length, 0);
  assert.equal((await readdir(f.directory)).length, 2);

  const accepted = await f.invoke("POST", "/messages", { body: {
    messageId: "allowed", text: "Use the host configuration.", actor: other.actor, context: other,
    host: { nativeTools: true }, configuration: { systemPrompt: "Override" }, engine: "codex", data: { injected: true }
  } });
  assert.equal(accepted.payload.status, "accepted");
  await f.dispatched[0].promise;
  const body = JSON.parse(f.requests[0].body);
  assert.equal(body.messages[0].content, "Answer briefly.");
  assert.equal(body.messages.at(-1).content, "Use the host configuration.");
  assert.equal((await f.invoke("GET")).payload.engine, "api");
});

test("workspace conversation actions use the host's resolved workspace and optional existing settings", async t => {
  const f = await fixture(t, { workspace: true });
  const snapshot = await f.invoke("GET", "", { body: { workspace: { id: "another-workspace" } } });
  assert.equal(snapshot.payload.id, "chat:one");
  assert.deepEqual(f.scopeInputs, [{ workspaceSlug: "trusted-workspace" }]);
  await assert.rejects(f.invoke("GET", "", {
    actor: { ...f.context, requestMeta: { resolvedWorkspaceContext: {} } }
  }), { status: 409, message: "Workspace selection required." });

  const options = { ...f.options, assistantConfigService: { getSettings() {}, updateSettings() {} } };
  assert.deepEqual(createAssistantActions(options).map(({ id }) => id), [
    actionIds.conversationRead, actionIds.conversationSend, actionIds.conversationCancel, actionIds.conversationSubscribe,
    actionIds.conversationInspectDelivery, actionIds.conversationGoalRead, actionIds.conversationGoalUpdate,
    actionIds.settingsRead, actionIds.settingsUpdate
  ]);
  const router = createRouter();
  registerRoutes(router, options);
  assert.equal(router.list().filter(({ path }) => path.endsWith("/settings")).length, 4);
});

test("declared conversation data keeps the authored target without becoming authentication or host configuration", async t => {
  const conversationDataSchema = createSchema({
    clientId: { type: "string", required: true, minLength: 1, maxLength: 128 },
    focus: { type: "object", required: true, schema: createSchema({
      projectSlug: { type: "string", required: true, minLength: 1, maxLength: 256 }
    }) }
  });
  const f = await fixture(t, { conversationDataSchema });
  const data = { clientId: "original-browser", focus: { projectSlug: "original-project" } };
  await assert.rejects(f.invoke("POST", "/messages", { actor: { ...f.context, actor: { id: "other-user" } }, body: {
    messageId: "forged", text: "Untrusted authored data", data
  } }), { code: "conversation_forbidden" });
  await assert.rejects(f.invoke("POST", "/messages", { body: {
    messageId: "undeclared", text: "Undeclared authored data", data: { ...data, actor: f.context.actor }
  } }), { code: "ACTION_VALIDATION_FAILED" });
  await assert.rejects(f.invoke("POST", "/messages", { body: {
    messageId: "malformed", text: "Invalid authored target", data: { ...data, focus: { projectSlug: "x".repeat(257) } }
  } }), { code: "ACTION_VALIDATION_FAILED" });
  assert.equal(f.requests.length, 0);

  const input = { messageId: "captured", text: "Discuss this project", data };
  const accepted = await f.invoke("POST", "/messages", { body: { ...input,
    actor: { id: "other-user" }, context: {}, host: { nativeTools: true }
  } });
  await f.dispatched[0].promise;
  assert.equal(accepted.payload.status, "accepted");
  const state = (await f.invoke("GET")).payload;
  assert.deepEqual(state.conversationLog[0].user.data, data);
  assert.equal(state.engine, "api");
  assert.equal(JSON.parse(f.requests[0].body).messages[0].content, "Answer briefly.");
  const repeated = await f.invoke("POST", "/messages", { body: input });
  assert.equal(repeated.payload.duplicate, true);
  assert.equal(repeated.payload.turnId, accepted.payload.turnId);
  await assert.rejects(f.invoke("POST", "/messages", { body: { ...input,
    data: { ...data, focus: { projectSlug: "new-project" } }
  } }), { code: "conversation_message_conflict" });
  assert.equal(f.requests.length, 1, "Retargeting a captured message cannot dispatch it again");
});

test("goal operations retain capabilities and cannot forward native host or attachment objects", async t => {
  const f = await fixture(t);
  const absentGoal = await f.invoke("GET", "/goal");
  assert.equal(absentGoal.payload, null);
  assert.equal(absentGoal.status, 204, "An absent native goal uses the client's existing no-content response contract");
  await assert.rejects(f.invoke("POST", "/goal", { body: {
    action: "set", messageId: "goal-one", expectedSegmentId: "current", objective: "Do this"
  } }), { code: "conversation_unsupported" });
  assert.equal(f.requests.length, 0, "An unsupported goal never starts inference");

  const calls = [];
  const definitions = createAssistantActions({ config, conversationRuntime: {
    async open(input) {
      assert.equal(input.id, "chat:one");
      assert.equal(input.context.actor.id, "owner");
      return { async updateGoal(goal) { calls.push(goal); return { status: "accepted" }; } };
    }
  } });
  const catalogue = createActionCatalogue();
  catalogue.register({ contributorId: "goal-boundary", domain: "assistant", actions: definitions });
  const route = f.routes.find(route => route.method === "POST" && route.path.endsWith("/goal"));
  const goal = { action: "set", messageId: "goal-one", expectedSegmentId: "current", expectedGoalId: null,
    objective: "Finish the requested work", tokenBudget: 1000, attachmentIds: ["authorized-file"] };
  let response;
  await route.handler({ headers: { "x-jskit-surface": "home" }, input: {
    params: { surfaceId: "home", conversationId: "chat:one" },
    body: { ...goal, actor: { id: "other" }, context: {}, host: { nativeTools: true }, engine: "codex",
      attachments: [{ path: "/private/secret" }], configuration: { systemPrompt: "Injected" } }
  }, executeAction({ actionId, surface, input }) {
    return catalogue.execute({ actionId, input, context: { ...f.context, surface } });
  } }, { code(status) { assert.equal(status, 200); return this; }, send(value) { response = value; } });
  assert.deepEqual(calls, [goal]);
  assert.deepEqual(response, { status: "accepted" });
  await assert.rejects(catalogue.execute({ actionId: actionIds.conversationGoalUpdate,
    input: { targetSurfaceId: "home", conversationId: "chat:one", ...goal, tokenBudget: -1 }, context: f.context }));
  assert.equal(calls.length, 1, "Malformed commands are rejected before native execution");

  const firstGoal = { action: "set", expectedSegmentId: null, expectedGoalId: null, objective: "Start the first native goal" };
  await route.handler({ headers: { "x-jskit-surface": "home" }, input: {
    params: { surfaceId: "home", conversationId: "chat:one" }, body: firstGoal
  }, executeAction({ actionId, surface, input }) {
    return catalogue.execute({ actionId, input, context: { ...f.context, surface } });
  } }, { code(status) { assert.equal(status, 200); return this; }, send(value) { response = value; } });
  assert.deepEqual(calls, [goal, firstGoal], "Explicitly absent identity reaches the existing runtime's first-Set check unchanged");
  for (const input of [
    { action: "set", objective: firstGoal.objective },
    { ...firstGoal, expectedSegmentId: "" }
  ]) {
    await assert.rejects(catalogue.execute({ actionId: actionIds.conversationGoalUpdate,
      input: { targetSurfaceId: "home", conversationId: "chat:one", ...input }, context: f.context }),
    { code: "ACTION_VALIDATION_FAILED" });
  }
  assert.equal(calls.length, 2, "Missing and empty identity are not an observed absence");
});

test("the supplied runtime route/action path imports without SQL or the old chat service", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (["@jskit-ai/database-runtime", "knex"].some(name => specifier === name || specifier.startsWith(name + "/")) ||
          specifier.endsWith("/chatService.js")) throw new Error("Unexpected legacy dependency: " + specifier);
      return nextResolve(specifier, context);
    } });
    for (const name of ["@jskit-ai/database-runtime", "knex"]) {
      await assert.rejects(() => import(name), /Unexpected legacy dependency/);
    }
    const { createAssistantActions } = await import(${JSON.stringify(new URL("../src/server/actions.js", import.meta.url).href)});
    const { registerRoutes } = await import(${JSON.stringify(new URL("../src/server/registerRoutes.js", import.meta.url).href)});
    const conversationRuntime = { async open() { throw new Error("Registration cannot open conversations."); } };
    const options = { config: ${JSON.stringify(config)}, conversationRuntime };
    assert.equal(createAssistantActions(options).length, 7);
    const routes = [];
    registerRoutes({ register(...args) { routes.push(args); } }, options);
    assert.equal(routes.length, 6);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("declared replacement keeps application policy and exact predecessor authorization", async t => {
  const absent = await fixture(t);
  assert.equal(absent.routes.some(route => route.path.endsWith("/replacement")), false);
  assert.equal(absent.catalogue.listDefinitions().some(action => action.id === actionIds.conversationReplace), false);
  const f = await fixture(t, { applicationChoices: true, workspace: true });
  const transcript = createConversationTranscript({ storage: f.storage });
  await transcript.writeConversationUserMessage("chat:one", { messageId: "prior-question", text: "Keep this history" });
  await transcript.writeConversationAssistantMessage("chat:one", { messageId: "prior-answer", text: "History remains visible" });
  const before = (await f.invoke("GET")).payload;
  const replacement = { operationId: "approved-renewal", expectedSegmentId: before.segmentId, choice: "renew" };
  const call = (body = { replacement }, options = {}) => f.invoke("POST", "/replacement", { body, ...options });
  await assert.rejects(call(undefined, { actor: { ...f.context, actor: { id: "another-person" } } }), { code: "conversation_forbidden" });
  await assert.rejects(call(undefined, { id: "unknown" }), { code: "conversation_forbidden" });
  for (const extra of [{ engine: "codex" }, { host: { nativeTools: true } }, { configuration: { integrationId: "private" } },
    { briefing: "Replace trusted continuity" }, { context: f.context }, { actor: f.context.actor }]) {
    await assert.rejects(call({ replacement: { ...replacement, ...extra } }), { code: "ACTION_VALIDATION_FAILED" });
  }
  await assert.rejects(call({ replacement: { ...replacement, expectedSegmentId: "stale-predecessor" } }),
    { code: "conversation_replacement_conflict" });
  const replaced = await call({ replacement, engine: "codex", host: { nativeTools: true }, context: { forged: true } });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.payload.operationId, replacement.operationId);
  assert.notEqual(replaced.payload.segmentId, before.segmentId);
  const current = (await f.invoke("GET")).payload;
  assert.equal(current.engine, "api");
  assert.deepEqual(current.configuration, before.configuration);
  assert.deepEqual(current.conversationLog, before.conversationLog);
  const repeated = await call();
  assert.equal(repeated.payload.segmentId, replaced.payload.segmentId, "a retry uses the existing replacement operation");
  assert.equal(repeated.payload.duplicate, true);
  assert.equal(f.requests.length, 0, "replacement does not send the briefing as an unrequested inference");
  assert.ok(f.scopeInputs.every(input => input.workspaceSlug === "trusted-workspace"));
  f.access.allowed = false;
  await assert.rejects(call(), { code: "conversation_forbidden" });
});
