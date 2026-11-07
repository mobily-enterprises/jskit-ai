import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import knexLib from "knex";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import migration from "../migrations/connectors_core_initial.cjs";
import { createConnectionStoreFeature, createCredentialProtection } from "../src/server/storage.js";

const owner = Object.freeze({ applicationId: "app", subjectId: "user-1" });

test("createConnectionStoreFeature owns the connector tables and provides the store on their handles as connectors.store", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  t.after(() => knex.destroy());
  await migration.up(knex);
  const resources = await createTestResourceRuntime({ knex });
  const protection = createCredentialProtection({ keys: { current: randomBytes(32) }, activeKeyId: "current" });
  let store = null;
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider,
      ActionProvider,
      defineProvider({ id: "test.resources", provides: { resources: "runtime.resources" }, setup: () => ({ resources }) }),
      createConnectionStoreFeature({ protection }),
      defineProvider({ id: "test.connections", requires: { connections: "connectors.store" }, setup({ connections }) { store = connections; } })
    ]
  });
  await runtime.start();
  t.after(() => runtime.shutdown());

  assert.deepEqual(resources.ownedTables().map(({ tableName, featureId }) => [tableName, featureId]), [
    ["connector_connections", "connectors.storage"],
    ["connector_authorization_attempts", "connectors.storage"]
  ]);
  const slot = { owner, integrationId: "calendar" };
  await store.withConnection(slot, async ({ connection, save, putAttempt }) => {
    assert.equal(connection, null);
    await save({ token: "t1" });
    await putAttempt({ state: "s1", expiresAt: 2_000 });
  });
  assert.deepEqual(await store.withConnection(slot, async ({ connection, latestAttempt, consumeAttempt }) => [
    connection,
    (await latestAttempt({ after: 1_000 }))?.state,
    (await consumeAttempt("s1"))?.state,
    await consumeAttempt("s1")
  ]), [{ token: "t1" }, "s1", "s1", null]);
  await store.withConnection(slot, ({ putAttempt }) => putAttempt({ state: "s2", expiresAt: 3_000 }));
  assert.equal(await store.pruneExpiredAttempts({ before: 3_000 }), 1);
});
