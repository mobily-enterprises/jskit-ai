import assert from "node:assert/strict";
import test from "node:test";

import { createService as createWebhookCheckoutProjectionService } from "../server/modules/billing/webhookCheckoutProjection.service.js";

test("checkout projection reconciles one_off checkout.session.completed without blocking pending-subscription state", async () => {
  let upsertPayload = null;
  let completedPendingCalls = 0;
  let reconciledCalls = 0;

  const projectionService = createWebhookCheckoutProjectionService({
    billingRepository: {
      async findCustomerByProviderCustomerId() {
        return {
          billableEntityId: 77
        };
      },
      async findBillableEntityById() {
        return {
          id: 77
        };
      },
      async lockSubscriptionsForEntity() {
        return [];
      },
      async findCheckoutIdempotencyByOperationKey() {
        return null;
      },
      async lockCheckoutSessionsForEntity() {
        return [];
      },
      async findCheckoutSessionByProviderSessionId() {
        return null;
      },
      async findCheckoutSessionByProviderOperationKey() {
        return null;
      },
      async upsertCheckoutSessionByOperationKey(payload) {
        upsertPayload = payload;
        return payload;
      }
    },
    billingCheckoutSessionService: {
      async markCheckoutSessionCompletedPendingSubscription() {
        completedPendingCalls += 1;
        return null;
      },
      async markCheckoutSessionReconciled() {
        reconciledCalls += 1;
        return null;
      }
    },
    stripeSdkService: {
      async retrieveCheckoutSession() {
        return null;
      }
    }
  });

  await projectionService.handleCheckoutSessionCompleted(
    {
      id: "cs_one_off_1",
      mode: "payment",
      customer: "cus_77",
      subscription: null,
      url: "https://checkout.stripe.test/cs_one_off_1",
      expires_at: 1_771_000_000,
      metadata: {
        operation_key: "op_one_off_1",
        billable_entity_id: "77",
        checkout_flow: "one_off"
      }
    },
    {
      trx: {},
      providerCreatedAt: new Date("2026-02-21T08:00:00.000Z"),
      providerEventId: "evt_checkout_one_off_completed"
    }
  );

  assert.equal(completedPendingCalls, 0);
  assert.equal(reconciledCalls, 1);
  assert.ok(upsertPayload);
  assert.equal(upsertPayload.status, "completed_reconciled");
  assert.equal(upsertPayload.operationKey, "op_one_off_1");
  assert.equal(upsertPayload.metadataJson.checkout_flow, "one_off");
});
