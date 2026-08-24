import assert from "node:assert/strict";
import test from "node:test";

import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { GoogleRewardedCoreFeature } from "../src/server/GoogleRewardedCoreProvider.js";
import {
  GoogleRewardedProviderConfigsFeature,
  GoogleRewardedRulesFeature,
  GoogleRewardedUnlockReceiptsFeature,
  GoogleRewardedWatchSessionsFeature
} from "../src/server/GoogleRewardedResources.js";

function valueProvider(id, capability, value) {
  return defineProvider({
    id,
    provides: { value: capability },
    setup() {
      return { value };
    }
  });
}

test("Google rewarded composes standard resource capabilities around one explicit domain feature", async () => {
  const routes = [];
  const resources = {};
  let actions;
  let googleRewarded;
  const knex = Object.assign(() => {}, {
    async transaction(callback) {
      return callback({});
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [
      createActionProvider(),
      valueProvider("test.database", "runtime.database", { knex }),
      valueProvider("test.http", "runtime.http", {
        router: {
          register(method, path, contract, handler) {
            routes.push({ method, path, contract, handler });
          }
        }
      }),
      valueProvider("test.json-rest-api", "runtime.json-rest-api", {
        resources,
        async addResource(name, config) {
          resources[name] = { config };
        }
      }),
      GoogleRewardedRulesFeature,
      GoogleRewardedProviderConfigsFeature,
      GoogleRewardedWatchSessionsFeature,
      GoogleRewardedUnlockReceiptsFeature,
      GoogleRewardedCoreFeature,
      defineProvider({
        id: "test.observer",
        requires: {
          actionCatalogue: "runtime.actions",
          rewarded: "google-rewarded.core"
        },
        setup(dependencies) {
          actions = dependencies.actionCatalogue;
          googleRewarded = dependencies.rewarded;
          return {};
        }
      })
    ]
  });

  await runtime.start();

  const definitions = actions.listDefinitions();
  assert.equal(definitions.length, 24);
  assert.deepEqual(
    definitions.slice(-4).map((entry) => entry.id),
    [
      "google-rewarded.current.read",
      "google-rewarded.start",
      "google-rewarded.grant",
      "google-rewarded.close"
    ]
  );
  assert.ok(definitions.every((entry) => !Object.hasOwn(entry, "dependencies")));
  assert.equal(typeof googleRewarded.getCurrentState, "function");
  assert.equal(routes.length, 24);
  assert.equal(Object.keys(resources).length, 4);

  await runtime.shutdown();
});
