import assert from "node:assert/strict";
import test from "node:test";

import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { AssistantFeature } from "../src/server/AssistantProvider.js";

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
