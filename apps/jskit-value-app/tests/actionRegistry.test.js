import assert from "node:assert/strict";
import test from "node:test";

import { createActionRuntimeServices } from "../server/runtime/actions/index.js";

function createRepositoryConfig() {
  return {
    actions: {
      assistant: {
        enabled: true,
        exposedActionIds: [],
        blockedActionIds: []
      },
      internal: {
        enabled: true,
        exposedActionIds: [],
        blockedActionIds: []
      }
    }
  };
}

test("action runtime services scaffold action registry and executor", async () => {
  const runtime = createActionRuntimeServices({
    services: {},
    repositories: {},
    repositoryConfig: createRepositoryConfig(),
    appConfig: {},
    rbacManifest: {}
  });

  assert.equal(typeof runtime.actionRegistry.execute, "function");
  assert.equal(typeof runtime.actionRegistry.executeStream, "function");
  assert.equal(typeof runtime.actionExecutor.execute, "function");
  assert.equal(typeof runtime.actionExecutor.executeStream, "function");
  assert.equal(typeof runtime.actionExecutor.listDefinitions, "function");
  assert.equal(typeof runtime.actionExecutor.getDefinition, "function");

  assert.deepEqual(runtime.actionRegistry.listDefinitions(), []);
  assert.deepEqual(runtime.actionExecutor.listDefinitions(), []);

  await assert.rejects(
    () =>
      runtime.actionExecutor.execute({
        actionId: "workspace.settings.read",
        input: {},
        context: {
          channel: "api",
          surface: "admin",
          permissions: ["workspace.settings.view"]
        }
      }),
    /Not found/
  );
});
