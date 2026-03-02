import assert from "node:assert/strict";
import test from "node:test";

import {
  composeFastifyPluginDefinitions,
  __testables as fastifyPluginTestables
} from "../../server/framework/composeFastifyPlugins.js";
import {
  startComposedBackgroundRuntimes,
  stopComposedBackgroundRuntimes,
  __testables as backgroundRuntimeTestables
} from "../../server/framework/composeBackgroundRuntimes.js";

test("composeFastifyPluginDefinitions resolves plugin contributions from module registry", () => {
  const pluginIds = composeFastifyPluginDefinitions().map((definition) => definition.id);
  assert.deepEqual(pluginIds, ["billingWebhookRawBody", "activityPubRawBody"]);

  const billingOnlyPluginIds = composeFastifyPluginDefinitions({
    enabledModuleIds: ["auth", "workspace", "actionRuntime", "billing"]
  }).map((definition) => definition.id);
  assert.deepEqual(billingOnlyPluginIds, ["billingWebhookRawBody"]);

  const contributedPluginIds = fastifyPluginTestables.resolveFastifyPluginDefinitionIds();
  assert.equal(contributedPluginIds.has("billingWebhookRawBody"), true);
  assert.equal(contributedPluginIds.has("activityPubRawBody"), true);
});

test("composed background runtime orchestration starts and stops only selected runtime services", () => {
  let billingStartCount = 0;
  let billingStopCount = 0;
  let socialStartCount = 0;
  let socialStopCount = 0;

  const runtimeServices = {
    billingWorkerRuntimeService: {
      start() {
        billingStartCount += 1;
      },
      stop() {
        billingStopCount += 1;
      }
    },
    socialOutboxWorkerRuntimeService: {
      start() {
        socialStartCount += 1;
      },
      stop() {
        socialStopCount += 1;
      }
    }
  };

  const runtimeServiceIds = backgroundRuntimeTestables.resolveBackgroundRuntimeServiceIds();
  assert.deepEqual(runtimeServiceIds, ["billingWorkerRuntimeService", "socialOutboxWorkerRuntimeService"]);

  startComposedBackgroundRuntimes(runtimeServices, {
    enabledModuleIds: ["auth", "workspace", "actionRuntime", "social"]
  });
  assert.equal(billingStartCount, 0);
  assert.equal(socialStartCount, 1);

  stopComposedBackgroundRuntimes(runtimeServices, {
    enabledModuleIds: ["auth", "workspace", "actionRuntime", "social"]
  });
  assert.equal(billingStopCount, 0);
  assert.equal(socialStopCount, 1);
});
