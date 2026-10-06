import assert from "node:assert/strict";
import test from "node:test";

import { createAssistantActions } from "../src/server/actions.js";
import { actionIds } from "../src/server/actionIds.js";

const CONFIG = Object.freeze({
  surfaceDefinitions: {
    home: { enabled: true, requiresWorkspace: false },
    admin: { enabled: true, requiresWorkspace: true },
    console: { enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" }
  },
  assistantSurfaces: {
    home: { settingsSurfaceId: "console", configScope: "global" },
    admin: { settingsSurfaceId: "admin", configScope: "workspace" }
  }
});

function createDefinitions() {
  return createAssistantActions({
    config: CONFIG,
    chatService: {
      streamChat() { return { ok: true }; },
      listConversations(query, { input }) { return { query, input }; },
      getConversationMessages(conversationId, query, { input }) {
        return { conversationId, query, input };
      }
    },
    assistantConfigService: {
      getSettings(input) { return { input }; },
      updateSettings(input, patch) { return { input, patch }; }
    }
  });
}

function findDefinition(definitions, id) {
  return definitions.find((definition) => definition.id === id);
}

test("assistant actions use configured runtime and settings surfaces without surface discovery", () => {
  const definitions = createDefinitions();

  assert.equal(definitions.length, 5);
  assert.deepEqual(findDefinition(definitions, actionIds.chatStream).surfaces, ["home", "admin"]);
  assert.deepEqual(findDefinition(definitions, actionIds.conversationsList).surfaces, ["home", "admin"]);
  assert.deepEqual(findDefinition(definitions, actionIds.settingsRead).surfaces, ["console", "admin"]);
  assert.ok(definitions.every((definition) => !Object.hasOwn(definition, "dependencies")));
  assert.equal(createAssistantActions({
    config: {},
    chatService: {},
    assistantConfigService: {}
  }).length, 0);
});

test("assistant conversations list keeps query nested under one schema definition", () => {
  const definition = findDefinition(createDefinitions(), actionIds.conversationsList);
  const result = definition.input.schema.patch({
    targetSurfaceId: "home",
    workspaceSlug: "example-workspace",
    query: { limit: 10, status: "active" }
  });

  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.validatedObject, {
    targetSurfaceId: "home",
    workspaceSlug: "example-workspace",
    query: { limit: 10, status: "active" }
  });
});

test("assistant conversation messages composes params and nested query", () => {
  const definition = findDefinition(createDefinitions(), actionIds.conversationMessagesList);
  const result = definition.input.schema.patch({
    targetSurfaceId: "home",
    conversationId: "123",
    query: { page: 2, pageSize: 25 }
  });

  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.validatedObject, {
    targetSurfaceId: "home",
    conversationId: 123,
    query: { page: 2, pageSize: 25 }
  });
});

test("assistant settings update keeps patch nested under one schema definition", () => {
  const definition = findDefinition(createDefinitions(), actionIds.settingsUpdate);
  const result = definition.input.schema.patch({
    targetSurfaceId: "home",
    patch: { systemPrompt: "Be concise." }
  });

  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.validatedObject, {
    targetSurfaceId: "home",
    patch: { systemPrompt: "Be concise." }
  });
});

test("host access wraps only canonical conversation definitions and receives the fixed subscription id", async () => {
  const wrapped = [];
  const subscribeActionId = "test.host.conversation.subscribe";
  const conversation = { read: () => ({ id: "retained-conversation" }) };
  const conversationAccess = {
    subscribeActionId,
    wrapAction(definition) {
      wrapped.push(definition);
      return { ...definition, permission: { require: "none" }, extensions: { hostAccess: true } };
    }
  };
  const definitions = createAssistantActions({
    config: CONFIG,
    conversationRuntime: { open: async () => conversation },
    conversationAccess,
    assistantConfigService: {}
  });
  assert.deepEqual(wrapped.map(({ id }) => id), [
    actionIds.conversationRead, actionIds.conversationSend, actionIds.conversationCancel, subscribeActionId,
    actionIds.conversationInspectDelivery, actionIds.conversationGoalRead, actionIds.conversationGoalUpdate
  ]);
  assert.equal(findDefinition(definitions, actionIds.conversationSubscribe), undefined);
  assert.equal(findDefinition(definitions, subscribeActionId).audit.actionName, subscribeActionId);
  for (const definition of wrapped) {
    const adapted = findDefinition(definitions, definition.id);
    assert.equal(adapted.input, definition.input);
    assert.equal(adapted.execute, definition.execute);
    assert.deepEqual(adapted.surfaces, ["home", "admin"]);
  }
  for (const id of [actionIds.settingsRead, actionIds.settingsUpdate]) {
    const settings = findDefinition(definitions, id);
    assert.equal(settings.permission.require, "authenticated");
    assert.equal(settings.extensions.hostAccess, undefined);
    assert.deepEqual(settings.surfaces, ["console", "admin"]);
  }
  assert.deepEqual(await findDefinition(definitions, actionIds.conversationRead).execute({
    targetSurfaceId: "home", conversationId: "retained-conversation"
  }, {}), { id: "retained-conversation" });
  const legacy = createAssistantActions({ config: CONFIG, chatService: {}, assistantConfigService: {},
    conversationAccess: { wrapAction() { assert.fail("Legacy definitions must retain their own access policy."); } } });
  assert.deepEqual(legacy.map(({ id }) => id), createDefinitions().map(({ id }) => id));
  assert.ok(legacy.every(definition => definition.permission.require === "authenticated"));
});
