import assert from "node:assert/strict";
import test from "node:test";
import knex from "knex";
import migration from "../migrations/payments_core_initial.cjs";
import { createKnexPaymentStore } from "../src/server/knexStore.js";
import { createPaymentService } from "../src/server/service.js";
import { validatePaymentConfiguration } from "../src/shared/configuration.js";

const document = {
  integrations: {
    billing: { provider: "stripe", accountMode: "shared", authentication: { method: "api-key", secretRef: "env:STRIPE_KEY" } },
    production: { provider: "stripe", accountMode: "shared", authentication: { method: "api-key", secretRef: "env:STRIPE_LIVE_KEY" } }
  },
  extensions: { payments: {
    version: 1,
    environments: {
      sandbox: { integrationId: "billing", providerAccountId: "acct_test", webhookSecretRef: "env:STRIPE_WEBHOOK_SECRET", returnUrlRef: "env:APP_URL" },
      live: { integrationId: "production", providerAccountId: "acct_live", webhookSecretRef: "env:STRIPE_LIVE_WEBHOOK_SECRET", returnUrlRef: "env:APP_URL" }
    },
    plans: { pro: { name: "Pro", amount: 1200, currency: "USD", interval: "month", features: ["export"], renewalCredits: 100 } }
  } }
};
const scope = { applicationId: "app", integrationId: "billing", providerAccountId: "acct_test", environment: "sandbox", subjectId: "tenant-a" };

test("portable configuration rejects secret literals, invalid prices and mismatched connector environments", () => {
  assert.equal(validatePaymentConfiguration(document).plans.pro.amount, 1200);
  for (const change of [
    (value) => { value.extensions.payments.plans.pro.amount = 0.5; },
    (value) => { value.extensions.payments.environments.sandbox.webhookSecretRef = "whsec_private"; },
    (value) => { value.integrations.billing.accountMode = "per-user"; },
    (value) => { value.integrations.billing.provider = "paddle"; value.integrations.billing.settings = { environment: "live" }; },
    (value) => { value.extensions.payments.plans.pro.features.push("export"); }
  ]) {
    const value = structuredClone(document); change(value);
    assert.throws(() => validatePaymentConfiguration(value), { code: "payment_configuration_invalid" });
  }
});

test("configuration accepts reactive objects and returns an independent plain snapshot", () => {
  const input = structuredClone(document);
  input.extensions.payments = new Proxy(input.extensions.payments, {});
  const configuration = validatePaymentConfiguration(input);
  assert.equal(configuration.plans.pro.amount, 1200);
  input.extensions.payments.plans.pro.amount = 2400;
  assert.equal(configuration.plans.pro.amount, 1200);
  assert.doesNotThrow(() => structuredClone(configuration));
});

test("transactional payment state isolates subjects, grants once, prevents overspend and reconciles current facts", async (t) => {
  const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  await migration.up(db);
  const store = createKnexPaymentStore({ knex: db });
  let now = 1000;
  const service = createPaymentService({ store, configuration: validatePaymentConfiguration(document), clock: () => now });
  try {
    await t.test("read-only inspection creates no rows and refuses a foreign merchant", async () => {
      assert.equal((await service.inspect(scope)).balance, 0);
      assert.equal((await db("payment_accounts")).length, 0);
      await assert.rejects(service.inspect({ ...scope, providerAccountId: "someone-else" }), { code: "payment_scope_invalid" });
    });
    await t.test("duplicate grants and concurrent debits preserve the balance", async () => {
      const grant = { reference: "topup-1", units: 10, expiresAt: 5000 };
      assert.equal((await service.grantCredits(scope, grant)).duplicate, false);
      assert.equal((await service.grantCredits(scope, grant)).duplicate, true);
      await assert.rejects(service.grantCredits(scope, { ...grant, units: 11 }), { code: "payment_reference_conflict" });
      const results = await Promise.allSettled(["job-1", "job-2"].map((id) => service.debitCredits(scope, { reference: id, units: 7 })));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal((await service.inspect(scope)).balance, 3);
      assert.equal((await service.inspect({ ...scope, subjectId: "tenant-b" })).balance, 0);
      assert.equal((await service.inspect({ ...scope, applicationId: "another-app" })).balance, 0);
      assert.equal((await service.inspect({ ...scope, integrationId: "production", providerAccountId: "acct_live", environment: "live" })).balance, 0);
      const id = results[0].status === "fulfilled" ? "job-1" : "job-2";
      assert.equal((await service.debitCredits(scope, { reference: id, units: 7 })).duplicate, true);
      assert.equal((await service.refundDebit(scope, { debitReference: id })).restored, 7);
      assert.equal((await service.refundDebit(scope, { debitReference: id })).duplicate, true);
    });
    await t.test("refunds do not resurrect expired grants", async () => {
      await service.debitCredits(scope, { reference: "expired-job", units: 4 });
      now = 6000;
      const result = await service.refundDebit(scope, { debitReference: "expired-job" });
      assert.equal(result.restored, 0);
      assert.equal(result.expired, 4);
      assert.equal((await service.inspect(scope)).balance, 0);
    });
    await t.test("customer bindings cannot be stolen or resolved across environments", async () => {
      await store.bindCustomer(scope, "cus_a", "tenant-a");
      await assert.rejects(store.bindCustomer(scope, "cus_a", "tenant-b"), /already bound/);
      await assert.rejects(service.reconcileEvent(scope, { eventId: "evt_unbound", customerId: "cus_b", load: async () => {} }), { code: "payment_customer_unbound" });
    });
    await t.test("event failure rolls back; retries grant once per renewal rather than event", async () => {
      const subscription = { id: "sub_a", status: "active", planId: "pro", periodEnd: 10000 };
      const renewal = { id: "invoice_a", planId: "pro", periodEnd: 10000 };
      const event = { eventId: "evt_a", customerId: "cus_a", load: async () => ({ subscription, renewal }) };
      await assert.rejects(service.reconcileEvent(scope, { ...event, load: async () => { throw new Error("provider unavailable"); } }), /unavailable/);
      assert.equal((await service.reconcileEvent(scope, event)).duplicate, false);
      assert.equal((await service.reconcileEvent(scope, event)).duplicate, true);
      await service.reconcileEvent(scope, { ...event, eventId: "evt_b" });
      assert.equal((await service.inspect(scope)).balance, 100);
      await service.requireFeature(scope, "export");
      // A late delivery loads current canceled state, not the old event payload.
      await service.reconcileEvent(scope, { ...event, eventId: "evt_older", load: async () => ({ subscription: { ...subscription, status: "canceled" } }) });
      await assert.rejects(service.requireFeature(scope, "export"), { code: "payment_feature_required" });
      assert.equal((await service.inspect(scope)).balance, 100);
    });
    await t.test("transaction interruption leaves neither receipt nor mutated balance", async () => {
      await assert.rejects(store.withAccount(scope, async (tx) => {
        tx.state.lots[0].remaining = 100000;
        await tx.record("interrupted", { invalid: true });
        throw new Error("abort");
      }), /abort/);
      assert.equal(await store.withAccount(scope, (tx) => tx.find("interrupted")), null);
      assert.equal((await service.inspect(scope)).balance, 100);
    });
  } finally {
    await migration.down(db);
    await db.destroy();
  }
});
