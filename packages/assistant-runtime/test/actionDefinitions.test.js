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
