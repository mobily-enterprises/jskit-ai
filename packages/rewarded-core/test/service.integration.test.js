import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { createCrudJsonApiRepository } from "@jskit-ai/crud-core/server/jsonApiRepository";
import {
  addResourceIfMissing,
  createJsonRestApiHost,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import providerConfigsMigration from "../migrations/rewarded_provider_configs_initial.cjs";
import rulesMigration from "../migrations/rewarded_rules_initial.cjs";
import watchSessionsMigration from "../migrations/rewarded_watch_sessions_initial.cjs";
import unlockReceiptsMigration from "../migrations/rewarded_unlock_receipts_initial.cjs";
import { resource as providerConfigsResource } from "../src/shared/rewardedProviderConfigResource.js";
import { resource as rulesResource } from "../src/shared/rewardedRuleResource.js";
import { resource as watchSessionsResource } from "../src/shared/rewardedWatchSessionResource.js";
import { resource as unlockReceiptsResource } from "../src/shared/rewardedUnlockReceiptResource.js";
import { createService } from "../src/server/service.js";

const RESOURCES = [
  ["rewardedProviderConfigs", providerConfigsResource, providerConfigsMigration],
  ["rewardedRules", rulesResource, rulesMigration],
  ["rewardedWatchSessions", watchSessionsResource, watchSessionsMigration],
  ["rewardedUnlockReceipts", unlockReceiptsResource, unlockReceiptsMigration]
];
const databaseUrl = process.env.REWARDED_TEST_DATABASE_URL;

function databaseOptions() {
  if (!databaseUrl) {
    return {
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 }
    };
  }

  const url = new URL(databaseUrl);
  assert.equal(url.protocol, "mysql:", "Rewarded shipped migrations require MySQL.");
  assert.match(url.pathname, /^\/jskit_rewarded_test_[a-z0-9_]+$/u, "Use an owned disposable rewarded test database.");
  return {
    client: "mysql2",
    connection: {
      host: url.hostname,
      port: Number(url.port) || 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      ...(url.searchParams.has("socketPath") ? { socketPath: url.searchParams.get("socketPath") } : {}),
      timezone: "Z"
    },
    pool: { min: 1, max: 1 }
  };
}

function actorContext(workspaceId = "1", userId = "7", testCase = "") {
  return {
    actor: { id: userId },
    scopeValues: { workspaceId, userId },
    testCase
  };
}

test(`rewarded grants use real resources and atomic transactions (${databaseUrl ? "MySQL shipped migrations" : "SQLite resource schema"})`, async (t) => {
  const knex = knexLib(databaseOptions());
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

  const api = await createJsonRestApiHost({ knex });
  const repositories = {};
  for (const [scopeName, resource, migration] of RESOURCES) {
    await addResourceIfMissing(api, scopeName, createJsonRestResourceScopeOptions(resource, {
      writeSerializers: { "datetime-utc": toDatabaseDateTimeUtc }
    }));
    if (databaseUrl) {
      await migration.up(knex);
    } else {
      // The shipped ON UPDATE defaults are MySQL-specific; SQLite verifies the resource workflow.
      await api.resources[scopeName].createKnexTable();
    }
    repositories[scopeName] = createCrudJsonApiRepository({ api, resource, resourceScopeName: scopeName });
  }

  const context = actorContext();
  const provider = await repositories.rewardedProviderConfigs.createDocument({
    surface: "app", enabled: true, placement: "/test/rewarded", provider: "google-publisher-tag"
  }, { context });
  await repositories.rewardedRules.createDocument({
    gateKey: "progress", surface: "app", enabled: true,
    unlockMinutes: 30, cooldownMinutes: 0, dailyLimit: null,
    title: "Log progress", description: "Rewarded workflow test"
  }, { context });

  const transactions = new Map();
  const events = [];
  let authorize = true;
  let failReceipt = false;
  const receiptFailure = new Error("Receipt storage hook failed");
  await api.customize({
    hooks: Object.fromEntries(["afterDataCallPatch", "afterDataCallPost", "afterCommit", "afterRollback"].map((event) => [event, {
      functionName: `rewarded-integration-${event}`,
      async handler({ scopeName, context: hookContext }) {
        if (!hookContext.testCase) return;
        assert.equal(hookContext.transaction, transactions.get(hookContext.testCase));
        events.push({ event, scopeName, testCase: hookContext.testCase });
        if (event === "afterDataCallPost" && scopeName === "rewardedUnlockReceipts" && failReceipt) {
          const receipt = await hookContext.transaction("rewarded_unlock_receipts")
            .where({ id: hookContext.id }).first();
          assert.ok(receipt, "The receipt write must occur before injecting the rollback failure.");
          throw receiptFailure;
        }
      }
    }]))
  });
  const service = createService({
    rewardedProviderConfigsRepository: repositories.rewardedProviderConfigs,
    rewardedRulesRepository: repositories.rewardedRules,
    rewardedWatchSessionsRepository: repositories.rewardedWatchSessions,
    rewardedUnlockReceiptsRepository: repositories.rewardedUnlockReceipts,
    async authorizeGrant({ session, context: grantContext, trx }) {
      transactions.set(grantContext.testCase, trx);
      const stored = await trx("rewarded_watch_sessions").where({ id: session.id }).first();
      assert.equal(String(stored.user_id), grantContext.scopeValues.userId);
      assert.equal(String(stored.workspace_id), grantContext.scopeValues.workspaceId);
      assert.equal(events.some((entry) => entry.event === "afterCommit" && entry.testCase === grantContext.testCase), false);
      return authorize;
    }
  });
  const gate = { workspaceSlug: "alpha", gateKey: "progress" };
  let successfulSession;

  await t.test("grant commits the session and receipt with one shared hook transaction", async () => {
    const started = await service.startGate(gate, { context });
    successfulSession = started.session.id;
    assert.equal(started.session.providerConfigId, provider.data.id);
    const result = await service.grantReward({ ...gate, sessionId: successfulSession }, {
      context: actorContext("1", "7", "success")
    });
    assert.equal(result.unlocked, true);
    assert.equal(result.session.status, "rewarded");
    assert.equal(result.unlock.watchSessionId, successfulSession);
    assert.equal(result.unlock.providerConfigId, provider.data.id);
    assert.ok(Date.parse(result.unlock.unlockedUntil) > Date.parse(result.unlock.grantedAt));
    assert.deepEqual(events.filter((entry) => entry.testCase === "success").map(({ event, scopeName }) => [event, scopeName]), [
      ["afterDataCallPatch", "rewardedWatchSessions"],
      ["afterDataCallPost", "rewardedUnlockReceipts"],
      ["afterCommit", "rewardedWatchSessions"],
      ["afterCommit", "rewardedUnlockReceipts"]
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
    assert.deepEqual(events.filter((entry) => entry.testCase === "replay"), []);
  });

  await t.test("another user or workspace cannot grant or discover the owner's unlock", async () => {
    for (const [workspaceId, userId] of [["1", "8"], ["2", "7"]]) {
      const scopedContext = actorContext(workspaceId, userId, `denied-${workspaceId}-${userId}`);
      await assert.rejects(service.grantReward({ ...gate, sessionId: successfulSession }, {
        context: scopedContext
      }), { statusCode: 404, transactionOutcome: "rolledBack" });
      assert.equal(transactions.has(scopedContext.testCase), false, "Ownership denial must precede grant authorization.");
      assert.equal((await repositories.rewardedUnlockReceipts.queryDocuments({}, { context: scopedContext })).data.length, 0);
    }
    assert.equal((await knex("rewarded_unlock_receipts").select()).length, 1);
  });

  await t.test("a receipt failure rolls back both persisted writes and allows a clean retry", async () => {
    const session = await repositories.rewardedWatchSessions.createDocument({
      gateKey: "progress", providerConfigId: provider.data.id, status: "started",
      startedAt: new Date().toISOString()
    }, { context });
    const grant = { ...gate, sessionId: session.data.id };
    authorize = false;
    await assert.rejects(service.grantReward(grant, { context: actorContext("1", "7", "unauthorized") }), {
      statusCode: 403, transactionOutcome: "rolledBack"
    });
    assert.equal((await knex("rewarded_watch_sessions").where({ id: session.data.id }).first()).status, "started");
    authorize = true;
    failReceipt = true;
    await assert.rejects(service.grantReward(grant, { context: actorContext("1", "7", "rollback") }), (error) => {
      assert.equal(error.transactionOutcome, "rolledBack");
      assert.match(error.message, /Receipt storage hook failed/u);
      return true;
    });
    const stored = await knex("rewarded_watch_sessions").where({ id: session.data.id }).first();
    assert.equal(stored.status, "started");
    assert.equal(stored.rewarded_at, null);
    assert.equal(stored.completed_at, null);
    assert.equal((await knex("rewarded_unlock_receipts").where({ watch_session_id: session.data.id }).select()).length, 0);
    const rollbackEvents = events.filter((entry) => entry.testCase === "rollback");
    assert.deepEqual(rollbackEvents.slice(0, 2).map(({ event, scopeName }) => [event, scopeName]), [
      ["afterDataCallPatch", "rewardedWatchSessions"],
      ["afterDataCallPost", "rewardedUnlockReceipts"]
    ]);
    assert.deepEqual(rollbackEvents.slice(2).map(({ event }) => event), ["afterRollback", "afterRollback"]);
    assert.deepEqual(rollbackEvents.slice(2).map(({ scopeName }) => scopeName).sort(), [
      "rewardedUnlockReceipts", "rewardedWatchSessions"
    ]);
    failReceipt = false;
    const retry = await service.grantReward(grant, { context: actorContext("1", "7", "retry") });
    assert.equal(retry.session.status, "rewarded");
    assert.equal((await knex("rewarded_unlock_receipts").where({ watch_session_id: session.data.id }).select()).length, 1);
  });
});
