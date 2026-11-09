import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import providerConfigsMigration from "../migrations/rewarded_provider_configs_initial.cjs";
import rulesMigration from "../migrations/rewarded_rules_initial.cjs";
import watchSessionsMigration from "../migrations/rewarded_watch_sessions_initial.cjs";
import unlockReceiptsMigration from "../migrations/rewarded_unlock_receipts_initial.cjs";
import { rewardedProviderConfigTableResource as providerConfigsResource } from "../src/shared/rewardedProviderConfigResource.js";
import { rewardedRuleTableResource as rulesResource } from "../src/shared/rewardedRuleResource.js";
import { rewardedWatchSessionTableResource as watchSessionsResource } from "../src/shared/rewardedWatchSessionResource.js";
import { rewardedUnlockReceiptTableResource as unlockReceiptsResource } from "../src/shared/rewardedUnlockReceiptResource.js";
import { createService } from "../src/server/service.js";
import { openOwnDatabase } from "./mysqlDatabase.js";

const RESOURCES = [
  ["rewardedProviderConfigs", providerConfigsResource, providerConfigsMigration],
  ["rewardedRules", rulesResource, rulesMigration],
  ["rewardedWatchSessions", watchSessionsResource, watchSessionsMigration],
  ["rewardedUnlockReceipts", unlockReceiptsResource, unlockReceiptsMigration]
];
const databaseUrl = process.env.REWARDED_TEST_DATABASE_URL;

async function openDatabase() {
  if (databaseUrl) return openOwnDatabase(databaseUrl, "service", { timezone: "Z" });
  const knex = knexLib({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 }
  });
  return { knex, dropDatabase: async () => {} };
}

function actorContext(workspaceId = "1", userId = "7", testCase = "") {
  return {
    actor: { id: userId },
    scopeValues: { workspaceId, userId },
    testCase
  };
}

test(`rewarded grants use real resources and atomic transactions (${databaseUrl ? "MySQL shipped migrations" : "SQLite resource schema"})`, async (t) => {
  const { knex, dropDatabase } = await openDatabase();
  let ownsTables = false;
  t.after(async () => {
    try {
      if (ownsTables) {
        for (const [, , migration] of [...RESOURCES].reverse()) {
          await migration.down(knex);
        }
        await knex.schema.dropTableIfExists("users");
        await knex.schema.dropTableIfExists("workspaces");
      }
    } finally {
      await knex.destroy();
      await dropDatabase();
    }
  });
  const tables = [...RESOURCES.map(([, resource]) => resource.tableName), "users", "workspaces"];
  for (const table of tables) {
    assert.equal(await knex.schema.hasTable(table), false, `Refuse to reuse existing ${table}.`);
  }
  ownsTables = true;
  for (const table of ["users", "workspaces"]) {
    await knex.schema.createTable(table, (builder) => {
      builder.bigInteger("id").unsigned().primary();
    });
  }
  await knex("users").insert([{ id: 7 }, { id: 8 }]);
  await knex("workspaces").insert([{ id: 1 }, { id: 2 }]);

  if (databaseUrl) {
    for (const [, , migration] of RESOURCES) {
      await migration.up(knex);
    }
  }
  // Each write of a test case reports itself from its resource's afterWrite hook, in the write's transaction.
  const transactions = new Map();
  const writes = [];
  let authorize = true;
  let failReceipt = false;
  const receiptFailure = new Error("Receipt storage hook failed");
  const owns = RESOURCES.map(([name, resource]) => ({
    resource,
    hooks: {
      async afterWrite({ operation, ids, options }) {
        const testCase = options.context?.testCase;
        if (!testCase) return;
        assert.equal(options.trx, transactions.get(testCase));
        writes.push({ testCase, operation, name });
        if (name === "rewardedUnlockReceipts" && failReceipt) {
          assert.ok(await repositories.rewardedUnlockReceipts.get(ids[0], {}, options),
            "The receipt write must occur before injecting the rollback failure.");
          throw receiptFailure;
        }
      }
    }
  }));
  // The shipped ON UPDATE defaults are MySQL-specific; SQLite builds the tables from the resource schemas.
  const runtime = await createTestResourceRuntime({ knex, createTables: !databaseUrl });
  const repositories = await runtime.own("rewarded.test", owns);

  const context = actorContext();
  const provider = await repositories.rewardedProviderConfigs.create({
    surface: "app", enabled: true, placement: "/test/rewarded", provider: "google-publisher-tag"
  }, { context });
  await repositories.rewardedRules.create({
    gateKey: "progress", surface: "app", enabled: true,
    unlockMinutes: 30, cooldownMinutes: 0, dailyLimit: null,
    title: "Log progress", description: "Rewarded workflow test"
  }, { context });

  const service = createService({
    rewardedProviderConfigsRepository: repositories.rewardedProviderConfigs,
    rewardedRulesRepository: repositories.rewardedRules,
    rewardedWatchSessionsRepository: repositories.rewardedWatchSessions,
    rewardedUnlockReceiptsRepository: repositories.rewardedUnlockReceipts,
    grantPolicy: {
      async authorizeGrant({ session, context: grantContext, options }) {
        transactions.set(grantContext.testCase, options.trx);
        const stored = await repositories.rewardedWatchSessions.get(session.id, {}, options);
        assert.equal(stored.id, session.id);
        assert.equal(writes.some((entry) => entry.testCase === grantContext.testCase), false);
        return authorize;
      }
    }
  });
  const gate = { workspaceSlug: "alpha", gateKey: "progress" };
  let successfulSession;

  await t.test("grant commits the session and receipt with one shared hook transaction", async () => {
    const started = await service.startGate(gate, { context });
    successfulSession = started.session.id;
    assert.equal(started.session.providerConfigId, provider.id);
    const result = await service.grantReward({ ...gate, sessionId: successfulSession }, {
      context: actorContext("1", "7", "success")
    });
    assert.equal(result.unlocked, true);
    assert.equal(result.session.status, "rewarded");
    assert.equal(result.unlock.watchSessionId, successfulSession);
    assert.equal(result.unlock.providerConfigId, provider.id);
    assert.ok(Date.parse(result.unlock.unlockedUntil) > Date.parse(result.unlock.grantedAt));
    assert.deepEqual(writes.filter((entry) => entry.testCase === "success").map(({ operation, name }) => [operation, name]), [
      ["patch", "rewardedWatchSessions"],
      ["create", "rewardedUnlockReceipts"]
    ]);
    assert.equal(transactions.get("success").isCompleted(), true);
    assert.equal((await knex("rewarded_watch_sessions").where({ id: successfulSession }).first()).status, "rewarded");
    assert.equal((await knex("rewarded_unlock_receipts").where({ watch_session_id: successfulSession }).select()).length, 1);
    assert.equal((await service.getCurrentState(gate, { context })).reason, "already-unlocked");
  });

  await t.test("replaying a grant returns its existing receipt without another write", async () => {
    const before = await knex("rewarded_unlock_receipts").where({ watch_session_id: successfulSession }).first();
    const replay = await service.grantReward({ ...gate, sessionId: successfulSession }, {
      context: actorContext("1", "7", "replay")
    });
    assert.equal(replay.unlock.id, String(before.id));
    assert.equal((await knex("rewarded_unlock_receipts").select()).length, 1);
    assert.deepEqual(writes.filter((entry) => entry.testCase === "replay"), []);
  });

  await t.test("another user or workspace cannot grant or discover the owner's unlock", async () => {
    for (const [workspaceId, userId] of [["1", "8"], ["2", "7"]]) {
      const scopedContext = actorContext(workspaceId, userId, `denied-${workspaceId}-${userId}`);
      await assert.rejects(service.grantReward({ ...gate, sessionId: successfulSession }, {
        context: scopedContext
      }), { statusCode: 404, code: "rewarded.session.notFound" });
      assert.equal(transactions.has(scopedContext.testCase), false, "Ownership denial must precede grant authorization.");
      assert.equal((await repositories.rewardedUnlockReceipts.query({ page: { size: 10 } }, { context: scopedContext })).records.length, 0);
    }
    assert.equal((await knex("rewarded_unlock_receipts").select()).length, 1);
  });

  await t.test("a receipt failure rolls back both persisted writes and allows a clean retry", async () => {
    const session = await repositories.rewardedWatchSessions.create({
      gateKey: "progress", providerConfigId: provider.id, status: "started",
      startedAt: new Date().toISOString()
    }, { context });
    const grant = { ...gate, sessionId: session.id };
    authorize = false;
    // The transaction rolls back, and the work's own refusal reaches the caller.
    await assert.rejects(service.grantReward(grant, { context: actorContext("1", "7", "unauthorized") }), {
      statusCode: 403, code: "rewarded.session.grantNotAuthorized"
    });
    assert.equal((await knex("rewarded_watch_sessions").where({ id: session.id }).first()).status, "started");
    authorize = true;
    failReceipt = true;
    // The rows below prove the rollback; the hook's own failure reaches the caller.
    await assert.rejects(service.grantReward(grant, { context: actorContext("1", "7", "rollback") }), /Receipt storage hook failed/u);
    const stored = await knex("rewarded_watch_sessions").where({ id: session.id }).first();
    assert.equal(stored.status, "started");
    assert.equal(stored.rewarded_at, null);
    assert.equal(stored.completed_at, null);
    assert.equal((await knex("rewarded_unlock_receipts").where({ watch_session_id: session.id }).select()).length, 0);
    assert.deepEqual(writes.filter((entry) => entry.testCase === "rollback").map(({ operation, name }) => [operation, name]), [
      ["patch", "rewardedWatchSessions"],
      ["create", "rewardedUnlockReceipts"]
    ]);
    assert.equal(transactions.get("rollback").isCompleted(), true);
    failReceipt = false;
    const retry = await service.grantReward(grant, { context: actorContext("1", "7", "retry") });
    assert.equal(retry.session.status, "rewarded");
    assert.equal((await knex("rewarded_unlock_receipts").where({ watch_session_id: session.id }).select()).length, 1);
  });

  await t.test("an unlock granted before 25 newer, expired receipts still unlocks the gate", async () => {
    await repositories.rewardedRules.create({
      gateKey: "long", surface: "app", enabled: true,
      unlockMinutes: 30, cooldownMinutes: 0, dailyLimit: null,
      title: "Long", description: "Long unlock test"
    }, { context });
    const hourAgo = new Date(Date.now() - 3600000);
    const unlocking = await repositories.rewardedUnlockReceipts.create({
      gateKey: "long", grantedAt: new Date(hourAgo.getTime() - 60000).toISOString(),
      unlockedUntil: new Date(Date.now() + 86400000).toISOString()
    }, { context });
    await repositories.rewardedUnlockReceipts.createMany(Array.from({ length: 25 }, (_, index) => ({
      gateKey: "long", grantedAt: new Date(hourAgo.getTime() + index * 1000).toISOString(), unlockedUntil: hourAgo.toISOString()
    })), { context });

    const state = await service.getCurrentState({ workspaceSlug: "alpha", gateKey: "long" }, { context });
    assert.equal(state.reason, "already-unlocked");
    assert.equal(String(state.unlock.id), String(unlocking.id));
  });

  await t.test("a daily limit above one page of receipts is counted exactly and reached", async () => {
    await repositories.rewardedRules.create({
      gateKey: "daily", surface: "app", enabled: true,
      unlockMinutes: 30, cooldownMinutes: 0, dailyLimit: 120,
      title: "Daily", description: "Daily limit test"
    }, { context });
    const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0));
    // Expired receipts: today's count against the limit, yesterday's and another user's do not.
    const receipts = (count, grantedAt) => Array.from({ length: count }, () => ({
      gateKey: "daily", grantedAt: grantedAt.toISOString(), unlockedUntil: dayStart.toISOString()
    }));
    await repositories.rewardedUnlockReceipts.createMany(receipts(119, dayStart), { context });
    await repositories.rewardedUnlockReceipts.createMany(receipts(5, new Date(dayStart.getTime() - 3600000)), { context });
    await repositories.rewardedUnlockReceipts.createMany(receipts(5, dayStart), { context: actorContext("1", "8") });
    const dailyGate = { workspaceSlug: "alpha", gateKey: "daily" };

    const open = await service.getCurrentState(dailyGate, { context });
    assert.equal(open.reason, "reward-required");
    assert.equal(open.dailyLimitRemaining, 1);
    await repositories.rewardedUnlockReceipts.create(receipts(1, dayStart)[0], { context });
    const reached = await service.getCurrentState(dailyGate, { context });
    assert.equal(reached.reason, "daily-limit-reached");
    assert.equal(reached.dailyLimitRemaining, 0);
  });
});
