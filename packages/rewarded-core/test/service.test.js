import assert from "node:assert/strict";
import test from "node:test";

import { createService } from "../src/server/service.js";

// A page of records, as a handle's query() answers it.
function page(records = []) {
  return { records, page: { size: records.length, hasMore: false, next: null } };
}

function createRuleRepository(rows = []) {
  return {
    async query() {
      return page(rows);
    }
  };
}

function createProviderConfigRepository(rows = []) {
  return {
    async query() {
      return page(rows);
    }
  };
}

function createUnlockReceiptRepository(rows = [], createdRecord = null) {
  return {
    async query() {
      return page(rows);
    },
    async create(attributes) {
      return { ...(createdRecord || {}), ...attributes, id: createdRecord?.id || "301" };
    }
  };
}

function createWatchSessionRepository({
  session = null,
  patchedSession = null
} = {}) {
  const calls = {
    patches: []
  };

  return {
    calls,
    async query() {
      return page([]);
    },
    async get() {
      return session ? { ...session } : null;
    },
    async patch(recordId, attributes) {
      calls.patches.push({
        recordId,
        patch: attributes
      });
      return { ...(patchedSession || session || {}), ...attributes, id: patchedSession?.id || recordId };
    },
    withTransaction(options, work) {
      return work(Object.freeze({ ...options, trx: "trx-1" }));
    }
  };
}

const REQUEST_CONTEXT = Object.freeze({
  requestMeta: {
    request: {
      user: {
        id: "7"
      }
    }
  }
});

test("getCurrentState reports a blocked gate when rule and provider config exist without an active unlock", async () => {
  const service = createService({
    grantPolicy: { authorizeGrant: async () => true },
    rewardedRulesRepository: createRuleRepository([
      {
        id: "11",
        gateKey: "progress-logging",
        surface: "app",
        enabled: true,
        unlockMinutes: 30,
        cooldownMinutes: 0,
        dailyLimit: null,
        title: "Log your workout",
        description: "Watch an ad to log progress."
      }
    ]),
    rewardedProviderConfigsRepository: createProviderConfigRepository([
      {
        id: "21",
        surface: "app",
        enabled: true,
        placement: "/123456/rewarded",
        provider: "google-publisher-tag"
      }
    ]),
    rewardedWatchSessionsRepository: createWatchSessionRepository(),
    rewardedUnlockReceiptsRepository: createUnlockReceiptRepository([])
  });

  const response = await service.getCurrentState(
    {
      workspaceSlug: "alpha",
      gateKey: "progress-logging"
    },
    {
      context: REQUEST_CONTEXT
    }
  );

  assert.equal(response.enabled, true);
  assert.equal(response.available, true);
  assert.equal(response.blocked, true);
  assert.equal(response.reason, "reward-required");
  assert.equal(response.providerConfig.placement, "/123456/rewarded");
});

test("getCurrentState reuses an active unlock receipt instead of blocking", async () => {
  const futureDate = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const service = createService({
    grantPolicy: { authorizeGrant: async () => true },
    rewardedRulesRepository: createRuleRepository([
      {
        id: "11",
        gateKey: "progress-logging",
        surface: "app",
        enabled: true,
        unlockMinutes: 30,
        cooldownMinutes: 0,
        dailyLimit: null,
        title: "Log your workout",
        description: "Watch an ad to log progress."
      }
    ]),
    rewardedProviderConfigsRepository: createProviderConfigRepository([
      {
        id: "21",
        surface: "app",
        enabled: true,
        placement: "/123456/rewarded",
        provider: "google-publisher-tag"
      }
    ]),
    rewardedWatchSessionsRepository: createWatchSessionRepository(),
    rewardedUnlockReceiptsRepository: createUnlockReceiptRepository([
      {
        id: "31",
        gateKey: "progress-logging",
        providerConfigId: "21",
        watchSessionId: "41",
        grantedAt: new Date().toISOString(),
        unlockedUntil: futureDate
      }
    ])
  });

  const response = await service.getCurrentState(
    {
      workspaceSlug: "alpha",
      gateKey: "progress-logging"
    },
    {
      context: REQUEST_CONTEXT
    }
  );

  assert.equal(response.blocked, false);
  assert.equal(response.reason, "already-unlocked");
  assert.equal(response.unlock.unlockedUntil, futureDate);
});

test("getCurrentState ignores caller surface overrides and evaluates the app-surface rule", async () => {
  const recordedRuleQueries = [];
  const recordedConfigQueries = [];
  const service = createService({
    grantPolicy: { authorizeGrant: async () => true },
    rewardedRulesRepository: {
      async query(params) {
        recordedRuleQueries.push(params);
        return page([
          {
            id: "11",
            gateKey: "progress-logging",
            surface: "app",
            enabled: true,
            unlockMinutes: 30,
            cooldownMinutes: 0,
            dailyLimit: null,
            title: "Log your workout",
            description: "Watch an ad to log progress."
          }
        ]);
      }
    },
    rewardedProviderConfigsRepository: {
      async query(params) {
        recordedConfigQueries.push(params);
        return page([
          {
            id: "21",
            surface: "app",
            enabled: true,
            placement: "/123456/rewarded",
            provider: "google-publisher-tag"
          }
        ]);
      }
    },
    rewardedWatchSessionsRepository: createWatchSessionRepository(),
    rewardedUnlockReceiptsRepository: createUnlockReceiptRepository([])
  });

  const response = await service.getCurrentState(
    {
      workspaceSlug: "alpha",
      gateKey: "progress-logging",
      surface: "admin"
    },
    {
      context: REQUEST_CONTEXT
    }
  );

  assert.equal(recordedRuleQueries[0]?.filters.surface, "app");
  assert.equal(recordedConfigQueries[0]?.filters.surface, "app");
  assert.equal(response.surface, "app");
  assert.equal(response.reason, "reward-required");
});

test("grantReward patches the watch session and creates an unlock receipt", async () => {
  const watchSessionsRepository = createWatchSessionRepository({
    session: {
      id: "41",
      gateKey: "progress-logging",
      providerConfigId: "21",
      status: "started",
      startedAt: new Date().toISOString()
    }
  });
  const createdReceiptPayloads = [];
  const unlockReceiptsRepository = {
    async query() {
      return page([]);
    },
    async create(attributes) {
      createdReceiptPayloads.push(attributes);
      return { ...attributes, id: "51" };
    }
  };

  const service = createService({
    grantPolicy: { authorizeGrant: async () => true },
    rewardedRulesRepository: createRuleRepository([
      {
        id: "11",
        gateKey: "progress-logging",
        surface: "app",
        enabled: true,
        unlockMinutes: 45,
        cooldownMinutes: 0,
        dailyLimit: null,
        title: "Log your workout",
        description: "Watch an ad to log progress."
      }
    ]),
    rewardedProviderConfigsRepository: createProviderConfigRepository([]),
    rewardedWatchSessionsRepository: watchSessionsRepository,
    rewardedUnlockReceiptsRepository: unlockReceiptsRepository
  });

  const response = await service.grantReward(
    {
      workspaceSlug: "alpha",
      sessionId: "41"
    },
    {
      context: REQUEST_CONTEXT
    }
  );

  assert.equal(response.unlocked, true);
  assert.equal(response.gateKey, "progress-logging");
  assert.equal(createdReceiptPayloads.length, 1);
  assert.equal(createdReceiptPayloads[0].watchSessionId, "41");
  assert.equal(createdReceiptPayloads[0].providerConfigId, "21");
  assert.equal(watchSessionsRepository.calls.patches.length, 1);
  assert.equal(watchSessionsRepository.calls.patches[0].recordId, "41");
  assert.equal(watchSessionsRepository.calls.patches[0].patch.status, "rewarded");
  assert.equal(typeof watchSessionsRepository.calls.patches[0].patch.rewardedAt, "string");
  assert.equal(
    watchSessionsRepository.calls.patches[0].patch.completedAt,
    watchSessionsRepository.calls.patches[0].patch.rewardedAt
  );
  assert.equal(createdReceiptPayloads[0].grantedAt, watchSessionsRepository.calls.patches[0].patch.rewardedAt);
  assert.equal(typeof createdReceiptPayloads[0].unlockedUntil, "string");
});


test("grant policy sees stored session and server context and rejects before writes", async () => {
  const watch = createWatchSessionRepository({ session: {
    id: "41", gateKey: "bonus", providerConfigId: "21", status: "started"
  } });
  let calls = 0;
  const dependencies = {
    rewardedRulesRepository: createRuleRepository([]),
    rewardedProviderConfigsRepository: createProviderConfigRepository([]),
    rewardedWatchSessionsRepository: watch,
    rewardedUnlockReceiptsRepository: {
      async create() { throw new Error("Must not write a receipt"); }
    }
  };
  for (const decision of [false, undefined, "true"]) {
    const service = createService({ ...dependencies, grantPolicy: { authorizeGrant: async ({ session, context, options }) => {
      calls += 1;
      assert.equal(session.id, "41");
      assert.equal(session.gateKey, "bonus");
      assert.equal(context, REQUEST_CONTEXT);
      assert.equal(options.context, REQUEST_CONTEXT);
      assert.ok(options.trx, "the policy reads inside the grant's transaction");
      return decision;
    } } });
    await assert.rejects(service.grantReward({ workspaceSlug: "alpha", sessionId: "41",
      authorized: true, gateKey: "forged" }, { context: REQUEST_CONTEXT }), /Reward grant is not authorized/);
  }
  assert.equal(calls, 3);
  assert.equal(watch.calls.patches.length, 0);
});
