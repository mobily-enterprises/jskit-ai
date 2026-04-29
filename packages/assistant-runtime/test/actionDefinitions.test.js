import assert from "node:assert/strict";
import test from "node:test";

import {
  withActionDefaults
} from "@jskit-ai/kernel/shared/actions";
import { ActionRuntimeServiceProvider } from "@jskit-ai/kernel/server/actions";

import { assistantActions } from "../src/server/actions.js";
import { actionIds } from "../src/server/actionIds.js";

function createSingletonApp() {
  const singletons = new Map();
  const instances = new Map();
  const tags = new Map();

  return {
    has(token) {
      return singletons.has(token) || instances.has(token);
    },
    singleton(token, factory) {
      singletons.set(token, {
        factory,
        resolved: false,
        value: undefined
      });
    },
    tag(token, tagName) {
      if (!this.has(token)) {
        throw new Error(`Cannot tag unresolved token "${String(token)}".`);
      }
      if (!tags.has(tagName)) {
        tags.set(tagName, new Set());
      }
      tags.get(tagName).add(token);
    },
    resolveTag(tagName) {
      const tagged = tags.get(tagName);
      if (!tagged) {
        return [];
      }
      return [...tagged].map((token) => this.make(token));
    },
    make(token) {
      if (instances.has(token)) {
        return instances.get(token);
      }
      if (!singletons.has(token)) {
        throw new Error(`Token "${String(token)}" is not registered.`);
      }
      const entry = singletons.get(token);
      if (!entry.resolved) {
        entry.value = entry.factory(this);
        entry.resolved = true;
        instances.set(token, entry.value);
      }
      return entry.value;
    }
  };
}

function createAssistantActionExecutor() {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.singleton("jskit.surface.runtime", () => ({
    listEnabledSurfaceIds() {
      return ["home", "console"];
    }
  }));

  app.singleton("assistant.chat.service", () => ({
    streamChat() {
      return { ok: true };
    },
    listConversations(query, { input }) {
      return { query, input };
    },
    getConversationMessages(conversationId, query, { input }) {
      return { conversationId, query, input };
    }
  }));

  app.singleton("assistant.config.service", () => ({
    getSettings(input) {
      return { input };
    },
    updateSettings(input, patch) {
      return { input, patch };
    }
  }));

  app.actions(
    withActionDefaults(assistantActions, {
      domain: "assistant",
      dependencies: {
        chatService: "assistant.chat.service",
        assistantConfigService: "assistant.config.service"
      }
    })
  );

  return app.make("actionExecutor");
}

function findDefinition(definitions, id) {
  return definitions.find((definition) => definition.id === id);
}

test("assistant-runtime actions materialize through the action runtime with single schema-definition inputs", () => {
  const actionExecutor = createAssistantActionExecutor();
  const definitions = actionExecutor.listDefinitions();

  assert.equal(definitions.length, assistantActions.length);

  for (const action of assistantActions) {
    assert.equal(Array.isArray(action.input), false, `${action.id} input must not be an array`);
  }

  for (const definition of definitions) {
    assert.equal(typeof definition.input?.schema?.patch, "function", `${definition.id} input schema must normalize`);
    assert.equal(
      typeof definition.input?.schema?.toJsonSchema,
      "function",
      `${definition.id} input schema must export`
    );
    assert.deepEqual(definition.surfaces, ["home", "console"]);
  }
});

test("assistant-runtime conversations list action keeps query nested under a schema definition", () => {
  const definition = findDefinition(createAssistantActionExecutor().listDefinitions(), actionIds.conversationsList);
  const result = definition.input.schema.patch({
    targetSurfaceId: "home",
    workspaceSlug: "example-workspace",
    query: {
      limit: 10,
      status: "active"
    }
  });

  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.validatedObject, {
    targetSurfaceId: "home",
    workspaceSlug: "example-workspace",
    query: {
      limit: 10,
      status: "active"
    }
  });
});

test("assistant-runtime conversation messages list action composes params and nested query", () => {
  const definition = findDefinition(createAssistantActionExecutor().listDefinitions(), actionIds.conversationMessagesList);
  const result = definition.input.schema.patch({
    targetSurfaceId: "home",
    conversationId: "123",
    query: {
      page: 2,
      pageSize: 25
    }
  });

  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.validatedObject, {
    targetSurfaceId: "home",
    conversationId: 123,
    query: {
      page: 2,
      pageSize: 25
    }
  });
});

test("assistant-runtime settings update action keeps patch nested under a schema definition", () => {
  const definition = findDefinition(createAssistantActionExecutor().listDefinitions(), actionIds.settingsUpdate);
  const result = definition.input.schema.patch({
    targetSurfaceId: "home",
    patch: {
      systemPrompt: "Be concise."
    }
  });

  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.validatedObject, {
    targetSurfaceId: "home",
    patch: {
      systemPrompt: "Be concise."
    }
  });
});
