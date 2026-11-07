import assert from "node:assert/strict";
import test from "node:test";

import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { CrudContractsProvider } from "@jskit-ai/crud-core/server/crudContracts";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { RewardedCoreFeature } from "../src/server/RewardedCoreFeature.js";
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

// A resource runtime that records which feature owns each table and answers stand-in handles.
function resourceRuntime(observed) {
  return {
    own(featureId, owns) {
      return Object.freeze(Object.fromEntries(owns.map((entry) => {
        const { name } = entry.resource || entry;
        if (observed.resources) {
          observed.resources[name] = featureId;
        }
        return [name, Object.freeze({ name })];
      })));
    },
    declareSystemScope() {
      throw new Error("Rewarded works in the caller's scope only.");
    }
  };
}

function createRewardedRuntime(grantPolicy, observed = {}) {
  return createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider, ActionProvider,
      valueProvider("test.grant-policy", "rewarded.grant-policy", grantPolicy),
      valueProvider("test.resources", "runtime.resources", resourceRuntime(observed)),
      valueProvider("test.http", "runtime.http", {
        router: {
          register(method, path, contract, handler) {
            observed.routes?.push({ method, path, contract, handler });
          }
        }
      }),
      CrudContractsProvider,
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
        setup({ actionCatalogue, rewarded }) {
          observed.actions = actionCatalogue;
          observed.rewarded = rewarded;
          return {};
        }
      })
    ]
  });
}

test("Rewarded composes standard resource capabilities around one explicit domain feature", async () => {
  const observed = { routes: [], resources: {} };
  const runtime = createRewardedRuntime({ authorizeGrant: async () => false }, observed);

  await runtime.start();
  const { routes, resources, actions, rewarded } = observed;

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
  assert.deepEqual(resources, {
    rewardedRules: "rewarded.rules",
    rewardedProviderConfigs: "rewarded.provider-configs",
    rewardedWatchSessions: "rewarded.watch-sessions",
    rewardedUnlockReceipts: "rewarded.unlock-receipts"
  });

  await runtime.shutdown();
});

test("Rewarded refuses a grant policy without authorizeGrant when it starts", async () => {
  const runtime = createRewardedRuntime({});

  await assert.rejects(runtime.start(), /rewarded\.grant-policy requires authorizeGrant\./u);
});
