import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createSchema } from "json-rest-schema";

import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { attachDirectRequestActionExecutor } from "@jskit-ai/kernel/server/http";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { AssistantFeature } from "../src/server/AssistantProvider.js";
import { actionIds } from "../src/server/actionIds.js";
import { ASSISTANT_CONVERSATION_SUBSCRIBE } from "../src/shared/conversationRealtime.js";

function valueProvider(id, capability, value) {
  return defineProvider({
    id,
    provides: { value: capability },
    setup() { return { value }; }
  });
}

test("AssistantFeature composes chat, transcripts, settings, routes, and action tools from capabilities", async () => {
  const routes = [];
  let actions;
  let assistant;
  const config = {
    surfaceDefinitions: {
      home: { enabled: true, requiresWorkspace: false },
      console: { enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" }
    },
    assistantSurfaces: {
      home: { settingsSurfaceId: "console", configScope: "global" }
    },
    assistantServer: {
      home: { aiConfigPrefix: "HOME" }
    }
  };
  const runtime = createCapabilityRuntime({
    providers: [
      createActionProvider(),
      valueProvider("test.config", "runtime.config", config),
      valueProvider("test.database", "runtime.database", { knex: Object.assign(() => {}, {}) }),
      valueProvider("test.env", "runtime.env", {}),
      valueProvider("test.http", "runtime.http", {
        router: {
          register(method, path, contract, handler) {
            routes.push({ method, path, contract, handler });
          }
        }
      }),
      AssistantFeature,
      defineProvider({
        id: "test.observer",
        requires: {
          actionCatalogue: "runtime.actions",
          assistantRuntime: "assistant.runtime"
        },
        setup(dependencies) {
          actions = dependencies.actionCatalogue;
          assistant = dependencies.assistantRuntime;
          return {};
        }
      })
    ]
  });

  await runtime.start();

  assert.deepEqual(actions.listDefinitions().map((entry) => entry.id), [
    "assistant.chat.stream",
    "assistant.conversations.list",
    "assistant.conversation.messages.list",
    "assistant.settings.read",
    "assistant.settings.update"
  ]);
  assert.equal(typeof assistant.services.chat.streamChat, "function");
  assert.equal(typeof assistant.toolCatalog.resolveToolSet, "function");
  assert.equal(routes.length, 5);
  assert.ok(actions.listDefinitions().every((entry) => !Object.hasOwn(entry, "dependencies")));

  await runtime.shutdown();
});

test("AssistantFeature uses a supplied file runtime without loading database or legacy chat integration", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    import { mkdtemp, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (["@jskit-ai/database-runtime", "knex"].some(name => specifier === name || specifier.startsWith(name + "/")) ||
          specifier.endsWith("/chatService.js") || specifier.endsWith("/createAssistantRuntime.js")) {
        throw new Error("Unexpected database/legacy import: " + specifier);
      }
      return nextResolve(specifier, context);
    } });
    for (const name of ["@jskit-ai/database-runtime", "knex"]) {
      await assert.rejects(() => import(name), /Unexpected database/);
    }
    const { AssistantFeature } = await import("@jskit-ai/assistant-runtime/server");
    const { createConversationRuntime, createFileConversationStorage } = await import("@jskit-ai/assistant-core/server/conversation");
    const { createActionProvider } = await import("@jskit-ai/kernel/server/actions");
    const { createCapabilityRuntime, defineProvider } = await import("@jskit-ai/kernel/shared/capabilities");
    const directory = await mkdtemp(join(tmpdir(), "assistant-feature-"));
    const runtime = createConversationRuntime({ storage: createFileConversationStorage({ directory }),
      authorize: ({ context }) => context.actor?.id === "42",
      connections: { resolve() { throw new Error("Reading a conversation must not invoke inference."); } } });
    const context = { actor: { id: "42" } };
    const conversation = await runtime.open({ id: "chat", context,
      configuration: { systemPrompt: "Answer briefly.", integrationId: "selected" } });
    const config = { surfaceDefinitions: { home: { enabled: true, requiresWorkspace: false } },
      assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } } };
    const valueProvider = (capability, value) => defineProvider({ id: capability,
      provides: { value: capability }, setup: () => ({ value }) });
    let registrations = 0, detachments = 0;
    try {
      for (const unrelatedDatabase of [false, true]) {
        const routes = [];
        let assistant, actions;
        const host = createCapabilityRuntime({ providers: [createActionProvider(),
          valueProvider("runtime.config", config), valueProvider("runtime.env", {}),
          valueProvider("runtime.http", { router: { register(...route) { routes.push(route); } } }),
          valueProvider("assistant.conversations", runtime),
          valueProvider("runtime.realtime", { onConnection(listener) {
            assert.equal(typeof listener, "function"); registrations++;
            return () => { detachments++; };
          } }),
          valueProvider("runtime.events", { publish() {} }),
          ...(unrelatedDatabase ? [valueProvider("runtime.database", { get knex() {
            throw new Error("Supplied conversation storage must not touch the host database.");
          } })] : []),
          AssistantFeature,
          defineProvider({ id: "observer", requires: { assistant: "assistant.runtime", actions: "runtime.actions" },
            setup(values) { ({ assistant, actions } = values); return {}; } })
        ] });
        try {
          await host.start();
          assert.equal(assistant.conversationRuntime, runtime);
          assert.equal(assistant.services.conversations, runtime);
          assert.equal(assistant.services.config, null);
          assert.equal(assistant.services.chat, undefined);
          assert.ok(actions.listDefinitions().some(entry => entry.id === "assistant.conversation.read"));
          assert.ok(!actions.listDefinitions().some(entry => entry.id === "assistant.chat.stream"));
          assert.ok(routes.some(([method, path]) => method === "GET" && path.endsWith("/:conversationId")));
          assert.ok(routes.every(([, path]) => !path.endsWith("/settings") && !path.endsWith("/chat/stream")));
        } finally { await host.shutdown(); }
        assert.equal((await conversation.read()).id, "chat");
      }
      assert.equal(registrations, 2);
      assert.equal(detachments, 2);
    } finally {
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("one AssistantFeature composes host access and declared data while settings retain authenticated access", { timeout: 10_000 }, async () => {
  const routes = [], wrapped = [], sent = [], choices = [], observers = new Set();
  let actions, connection, releaseConnection;
  let registrations = 0, releases = 0, requestReads = 0;
  const config = { surfaceDefinitions: { home: { enabled: true, requiresWorkspace: false } },
    assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } } };
  const conversation = {
    read: async () => ({ id: "persisted-local", status: "ready", conversationLog: [] }),
    async send(input) { sent.push(input); return { messageId: input.messageId, status: "accepted" }; },
    async configure(input) { choices.push({ configuration: input }); return input; },
    async select(input) { choices.push({ selection: input }); return input; },
    async replace(input) { choices.push({ replacement: input }); return input; },
    async subscribe(listener) { observers.add(listener); return () => observers.delete(listener); }
  };
  const conversationRuntime = {
    conversationDataSchema: createSchema({ clientId: { type: "string", required: true, minLength: 1 } }),
    conversationConfigurationSchema: createSchema({ effort: { type: "string", required: true, enum: ["low"] } }),
    conversationSelectionSchema: createSchema({ modelChoice: { type: "string", required: true, enum: ["offered"] } }),
    conversationReplacementSchema: createSchema({ choice: { type: "string", required: true, enum: ["renew"] } }),
    async open({ id, context }) {
      assert.equal(id, "persisted-local");
      assert.equal(context.hostAuthorized, true);
      assert.equal(context.actor, null, "Host access must not fabricate an authenticated local actor.");
      return conversation;
    }
  };
  const router = { register(method, path, contract, handler) { routes.push({ method, path, contract, handler }); } };
  function requireHostRequest(request) {
    if (request?.headers?.["x-fixture-access"] !== "allowed") {
      throw Object.assign(new Error("Host request denied."), { statusCode: 403 });
    }
  }
  const access = {
    router: { register(method, path, contract, handler) {
      router.register(method, path, { ...contract, auth: "public" }, (request, reply) => {
        requireHostRequest(request);
        return handler(request, reply);
      });
    } },
    wrapAction(definition) {
      wrapped.push(definition.id);
      return { ...definition, permission: { require: "none" }, execute(input, context, deps) {
        requireHostRequest(context.requestMeta?.request);
        return definition.execute(input, { ...context, hostAuthorized: true }, deps);
      } };
    },
    subscribeActionId: "test.host.conversation.subscribe",
    requestPolicy: "host"
  };
  const host = createCapabilityRuntime({
    providers: [createActionProvider(), AssistantFeature, defineProvider({
      id: "test.host.observer", requires: { catalogue: "runtime.actions", assistant: "assistant.runtime" },
      setup({ catalogue, assistant }) {
        actions = catalogue;
        assert.equal(assistant.conversationRuntime, conversationRuntime);
        return {};
      }
    })],
    inputs: {
      "runtime.config": config, "runtime.env": {}, "runtime.http": { router },
      "assistant.conversations": conversationRuntime, "assistant.conversation.access": access,
      "assistant.settings": {}, "runtime.events": { async publish() {} },
      "runtime.realtime": { onConnection(listener) {
        registrations++;
        connection = listener;
        return () => { releases++; releaseConnection?.(); };
      } }
    }
  });
  await host.start();
  try {
    assert.equal(registrations, 1);
    assert.equal(wrapped.length, 10);
    assert.ok(wrapped.includes(access.subscribeActionId));
    assert.ok(!wrapped.includes(actionIds.conversationSubscribe));
    assert.equal(actions.listDefinitions().length, 12);
    assert.equal(routes.length, 11);
    assert.ok(routes.filter(route => route.path.endsWith("/settings")).every(route => route.contract.auth === "required"));
    assert.ok(routes.filter(route => !route.path.endsWith("/settings")).every(route => route.contract.auth === "public"));
    assert.equal(actions.getDefinition(actionIds.settingsRead).permission.require, "authenticated");
    const sendRoute = routes.find(route => route.path.endsWith("/:conversationId/messages"));
    const body = { messageId: "authored-message", text: "A question", data: { clientId: "original-client" } };
    assert.deepEqual(sendRoute.contract.body.schema.patch(body).errors, {});
    const forged = { ...body, data: { ...body.data, actor: "other-user" } };
    assert.notDeepEqual(sendRoute.contract.body.schema.patch(forged).errors, {});
    const request = { headers: { "x-jskit-surface": "home", "x-fixture-access": "allowed" },
      input: { params: { surfaceId: "home", conversationId: "persisted-local" }, body } };
    attachDirectRequestActionExecutor({ actions, request });
    const reply = { code(status) { this.status = status; return this; }, send(value) { this.value = value; } };
    await sendRoute.handler(request, reply);
    assert.equal(reply.status, 202);
    assert.deepEqual(sent, [body]);
    await assert.rejects(async () => sendRoute.handler({ ...request, headers: {} }, reply), /Host request denied/);
    const context = { channel: "api", surface: "home", requestMeta: { request } };
    await assert.rejects(actions.execute({ actionId: actionIds.conversationSend,
      input: { targetSurfaceId: "home", conversationId: "persisted-local", ...forged }, context }),
    error => error.code === "ACTION_VALIDATION_FAILED");
    await assert.rejects(actions.execute({ actionId: actionIds.conversationRead,
      input: { targetSurfaceId: "home", conversationId: "persisted-local" },
      context: { channel: "api", surface: "home" } }), /Host request denied/);
    await assert.rejects(actions.execute({ actionId: actionIds.settingsRead,
      input: { targetSurfaceId: "home" }, context }), error => error.code === "ACTION_AUTHENTICATION_REQUIRED");
    for (const [suffix, body] of [["configuration", { configuration: { effort: "low" } }],
      ["selection", { selection: { modelChoice: "offered" } }],
      ["replacement", { replacement: { choice: "renew" } }]]) {
      const route = routes.find(route => route.path.endsWith(`/:conversationId/${suffix}`));
      assert.deepEqual(route.contract.body.schema.patch(body).errors, {});
      const choiceRequest = { ...request, input: { ...request.input, body } };
      attachDirectRequestActionExecutor({ actions, request: choiceRequest });
      await route.handler(choiceRequest, reply);
      assert.equal(reply.status, 200);
      await assert.rejects(async () => route.handler({ ...choiceRequest, headers: {} }, reply), /Host request denied/);
    }
    assert.deepEqual(choices, [{ configuration: { effort: "low" } }, { selection: { modelChoice: "offered" } },
      { replacement: { choice: "renew" } }]);
    const socket = Object.assign(new EventEmitter(), { id: "host-socket", connected: true });
    releaseConnection = connection({ socket,
      authenticate() { assert.fail("Explicit host policy must use the revalidating host request facility."); },
      async readRequest() { requestReads++; return { headers: { "x-fixture-access": "allowed" } }; }
    });
    const subscribed = await new Promise(resolve => socket.emit(ASSISTANT_CONVERSATION_SUBSCRIBE, {
      subscriptionId: "host-view", conversationId: "persisted-local", targetSurfaceId: "home", hostSurfaceId: "home"
    }, resolve));
    assert.equal(subscribed.ok, true);
    assert.equal(subscribed.state.id, "persisted-local");
    assert.equal(requestReads, 1);
    assert.equal(observers.size, 1);
    assert.equal(socket.listenerCount(ASSISTANT_CONVERSATION_SUBSCRIBE), 1);
  } finally { await host.shutdown(); }
  assert.equal(releases, 1);
  assert.equal(observers.size, 0);
  assert.equal((await conversation.read()).id, "persisted-local");
});

test("AssistantFeature rejects incomplete host access before registering routes or actions", async () => {
  const validAccess = { router: { register() {} }, wrapAction: definition => definition,
    subscribeActionId: "test.host.conversation.subscribe", requestPolicy: "host" };
  for (const [conversationRuntime, access] of [
    [{ open() {} }, { ...validAccess, router: null }],
    [{ open() {} }, { ...validAccess, wrapAction: null }],
    [{ open() {} }, { ...validAccess, requestPolicy: "public" }],
    [{ open() {} }, { ...validAccess, subscribeActionId: actionIds.conversationSubscribe }],
    [null, validAccess]
  ]) {
    let registrations = 0;
    const host = createCapabilityRuntime({ providers: [createActionProvider(), AssistantFeature], inputs: {
      "runtime.config": {}, "runtime.env": {},
      "runtime.http": { router: { register() { registrations++; } } },
      "assistant.conversation.access": access,
      ...(conversationRuntime ? { "assistant.conversations": conversationRuntime } : {})
    } });
    await assert.rejects(host.start(), /assistant\.conversation\.access/);
    assert.equal(registrations, 0);
  }
});
