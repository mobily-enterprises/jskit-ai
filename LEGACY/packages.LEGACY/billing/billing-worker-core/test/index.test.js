import assert from "node:assert/strict";
import test from "node:test";
import * as billingWorker from "../src/lib/index.js";

test("billing worker core exports worker services", () => {
  assert.equal(typeof billingWorker.createBillingOutboxWorkerService, "function");
  assert.equal(typeof billingWorker.createBillingRemediationWorkerService, "function");
  assert.equal(typeof billingWorker.createBillingReconciliationService, "function");
  assert.equal(typeof billingWorker.createBillingWorkerRuntimeService, "function");
  assert.equal(typeof billingWorker.createBillingDisabledServices, "function");
  assert.equal(typeof billingWorker.createBillingSubsystem, "function");
  assert.deepEqual(billingWorker.BILLING_SUBSYSTEM_EXPORT_IDS, [
    "billingPolicyService",
    "billingPricingService",
    "billingIdempotencyService",
    "billingCheckoutSessionService",
    "billingCheckoutOrchestrator",
    "billingWebhookService",
    "billingOutboxWorkerService",
    "billingRemediationWorkerService",
    "billingReconciliationService",
    "billingRealtimePublishService",
    "billingWorkerRuntimeService",
    "billingService"
  ]);
});

test("createBillingSubsystem returns disabled fail-closed services when billing is disabled", async () => {
  const subsystem = billingWorker.createBillingSubsystem({
    repositories: {},
    services: {},
    env: {},
    repositoryConfig: {
      billing: {
        enabled: false
      }
    }
  });

  assert.equal(subsystem.billingPromoProvisioner, null);
  assert.equal(typeof subsystem.billingService.listPlans, "function");

  await assert.rejects(
    () => subsystem.billingService.listPlans({}),
    (error) => Number(error?.statusCode || 0) === 404
  );

  const disabledExecResult = await subsystem.billingService.executeWithEntitlementConsumption({
    action() {
      return "ok";
    }
  });
  assert.deepEqual(disabledExecResult, "ok");
});
