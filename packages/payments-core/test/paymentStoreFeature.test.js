import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import migration from "../migrations/payments_core_initial.cjs";
import { PaymentStoreFeature } from "../src/server/storage.js";

const merchant = Object.freeze({ applicationId: "app", integrationId: "billing", providerAccountId: "acct_test", environment: "sandbox" });

test("PaymentStoreFeature owns the payment tables and provides the store on their handles as payments.store", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  t.after(() => knex.destroy());
  await migration.up(knex);
  const resources = await createTestResourceRuntime({ knex });
  let store = null;
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider,
      ActionProvider,
      defineProvider({ id: "test.resources", provides: { resources: "runtime.resources" }, setup: () => ({ resources }) }),
      PaymentStoreFeature,
      defineProvider({ id: "test.payments", requires: { payments: "payments.store" }, setup({ payments }) { store = payments; } })
    ]
  });
  await runtime.start();
  t.after(() => runtime.shutdown());

  assert.deepEqual(resources.ownedTables().map(({ tableName, featureId }) => [tableName, featureId]), [
    ["payment_accounts", "payments.store"],
    ["payment_entries", "payments.store"],
    ["payment_customers", "payments.store"],
    ["payment_catalogues", "payments.store"]
  ]);
  const scope = { ...merchant, subjectId: "tenant-a" };
  assert.equal(await store.withAccount(scope, async ({ state, record }) => {
    state.lots.push({ credits: 2 });
    await record("grant:1", { credits: 2 });
    return "granted";
  }), "granted");
  assert.deepEqual(await store.inspect(scope), { lots: [{ credits: 2 }], subscriptions: {} });
  assert.deepEqual(await store.withAccount(scope, ({ find }) => find("grant:1")), { credits: 2 });
  await store.bindCustomer(merchant, "cus_1", "tenant-a");
  assert.equal(await store.resolveCustomer(merchant, "cus_1"), "tenant-a");
  await store.withCatalogue(merchant, async (state) => {
    state.revision = 1;
  });
  assert.deepEqual(await store.inspectCatalogue(merchant), { plans: {}, history: [], revision: 1 });
});
