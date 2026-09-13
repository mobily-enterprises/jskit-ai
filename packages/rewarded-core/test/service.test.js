import assert from "node:assert/strict";
import test from "node:test";

import { createService } from "../src/server/service.js";

function createRecordDocument(type, id, attributes = {}) {
  return {
    data: {
      type,
      id: String(id),
      attributes: {
        ...attributes
      }
    }
  };
}

function createCollectionDocument(type, rows = []) {
  return {
    data: rows.map((entry, index) => ({
      type,
      id: String(entry?.id ?? index + 1),
      attributes: {
        ...entry
      }
    }))
  };
}

function createRuleRepository(rows = []) {
  return {
    async queryDocuments() {
      return createCollectionDocument("rewardedRules", rows);
    }
  };
}

function createProviderConfigRepository(rows = []) {
  return {
    async queryDocuments() {
      return createCollectionDocument("rewardedProviderConfigs", rows);
    }
  };
}

function createUnlockReceiptRepository(rows = [], createdRecord = null) {
  return {
    async queryDocuments() {
      return createCollectionDocument("rewardedUnlockReceipts", rows);
    },
    async createDocument(payload) {
      return createRecordDocument("rewardedUnlockReceipts", createdRecord?.id || "301", {
        ...(createdRecord || {}),
        ...payload
      });
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
    async queryDocuments() {
      return createCollectionDocument("rewardedWatchSessions", []);
    },
    async getDocumentById() {
      return session ? createRecordDocument("rewardedWatchSessions", session.id, session) : null;
    },
    async patchDocumentById(recordId, patch) {
      calls.patches.push({
        recordId,
        patch
      });
      return createRecordDocument("rewardedWatchSessions", patchedSession?.id || recordId, {
        ...(patchedSession || session || {}),
        ...patch
      });
    },
    withTransaction(work) {
      return work("trx-1");
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
    authorizeGrant: async () => true,
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
    authorizeGrant: async () => true,
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
    authorizeGrant: async () => true,
    rewardedRulesRepository: {
      async queryDocuments(query) {
        recordedRuleQueries.push(query);
        return createCollectionDocument("rewardedRules", [
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
      async queryDocuments(query) {
        recordedConfigQueries.push(query);
        return createCollectionDocument("rewardedProviderConfigs", [
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

  assert.equal(recordedRuleQueries[0]?.surface, "app");
  assert.equal(recordedConfigQueries[0]?.surface, "app");
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
    async queryDocuments() {
      return createCollectionDocument("rewardedUnlockReceipts", []);
    },
    async createDocument(payload) {
      createdReceiptPayloads.push(payload);
      return createRecordDocument("rewardedUnlockReceipts", "51", payload);
    }
  };

  const service = createService({
    authorizeGrant: async () => true,
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
      async createDocument() { throw new Error("Must not write a receipt"); }
    }
  };
  assert.throws(() => createService(dependencies), /authorizeGrant policy/);
  for (const decision of [false, undefined, "true"]) {
    const service = createService({ ...dependencies, authorizeGrant: async ({ session, context, trx }) => {
      calls += 1;
      assert.equal(session.id, "41");
      assert.equal(session.gateKey, "bonus");
      assert.equal(context, REQUEST_CONTEXT);
      assert.ok(trx);
      return decision;
    } });
    await assert.rejects(service.grantReward({ workspaceSlug: "alpha", sessionId: "41",
      authorized: true, gateKey: "forged" }, { context: REQUEST_CONTEXT }), /Reward grant is not authorized/);
  }
  assert.equal(calls, 3);
  assert.equal(watch.calls.patches.length, 0);
});
