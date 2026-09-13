import assert from "node:assert/strict";
import test from "node:test";

import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { RewardedCoreFeature } from "../src/server/RewardedCoreProvider.js";
import {
  RewardedProviderConfigsFeature,
  RewardedRulesFeature,
  RewardedUnlockReceiptsFeature,
  RewardedWatchSessionsFeature
} from "../src/server/RewardedResources.js";

function valueProvider(id, capability, value) {
  return defineProvider({
    id,
    provides: { value: capability },
    setup() {
      return { value };
    }
  });
}

test("Rewarded composes standard resource capabilities around one explicit domain feature", async () => {
  const routes = [];
  const resources = {};
  let actions;
  let rewarded;
  const knex = Object.assign(() => {}, {
    async transaction(callback) {
      return callback({});
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [
      createActionProvider(),
      valueProvider("test.grant-policy", "rewarded.grant-policy", { authorizeGrant: async () => false }),
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
      RewardedRulesFeature,
      RewardedProviderConfigsFeature,
      RewardedWatchSessionsFeature,
      RewardedUnlockReceiptsFeature,
      RewardedCoreFeature,
      defineProvider({
        id: "test.observer",
        requires: {
          actionCatalogue: "runtime.actions",
          rewarded: "rewarded.core"
        },
        setup(dependencies) {
          actions = dependencies.actionCatalogue;
          rewarded = dependencies.rewarded;
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
      "rewarded.current.read",
      "rewarded.start",
      "rewarded.grant",
      "rewarded.close"
    ]
  );
  assert.ok(definitions.every((entry) => !Object.hasOwn(entry, "dependencies")));
  assert.equal(typeof rewarded.getCurrentState, "function");
  assert.equal(routes.length, 24);
  assert.equal(Object.keys(resources).length, 4);

  await runtime.shutdown();
});
