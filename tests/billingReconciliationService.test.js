import assert from "node:assert/strict";
import test from "node:test";

import { createService as createReconciliationService } from "../server/modules/billing/reconciliation.service.js";

test("reconciliation pending_recent replays only active-provider failed webhooks with explicit provider", async () => {
  const replayCalls = [];

  const billingRepository = {
    async acquireReconciliationRun() {
      return {
        acquired: true,
        run: {
          id: 31,
          leaseVersion: 4
        }
      };
    },
    async transaction(work) {
      return work({});
    },
    async listPendingIdempotencyRows() {
      return [
        {
          id: 401,
          provider: "paddle"
        }
      ];
    },
    async listFailedWebhookEvents() {
      return [
        {
          provider: "paddle",
          providerEventId: "evt_paddle_failed",
          payloadJson: {
            id: "evt_paddle_failed"
          },
          lastFailedAt: "2026-02-21T07:00:00.000Z",
          updatedAt: "2026-02-21T07:00:00.000Z",
          receivedAt: "2026-02-21T07:00:00.000Z"
        },
        {
          provider: "stripe",
          providerEventId: "evt_stripe_failed",
          payloadJson: {
            id: "evt_stripe_failed"
          },
          lastFailedAt: "2026-02-21T07:00:00.000Z",
          updatedAt: "2026-02-21T07:00:00.000Z",
          receivedAt: "2026-02-21T07:00:00.000Z"
        }
      ];
    },
    async updateReconciliationRunByLease({ id, leaseVersion, patch }) {
      return {
        id,
        leaseVersion: Number(patch?.leaseVersion || leaseVersion),
        ...patch
      };
    }
  };

  const service = createReconciliationService({
    billingRepository,
    billingProviderAdapter: {
      provider: "stripe",
      async retrieveCheckoutSession() {
        return null;
      },
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    billingCheckoutSessionService: {},
    billingWebhookService: {
      async reprocessStoredEvent(payload) {
        replayCalls.push(payload);
      }
    }
  });

  const result = await service.runScope({
    provider: "stripe",
    scope: "pending_recent",
    runnerId: "test-runner",
    now: new Date("2026-02-21T08:00:00.000Z")
  });

  assert.equal(result.skipped, false);
  assert.equal(result.summary.scannedCount, 1);
  assert.equal(replayCalls.length, 1);
  assert.equal(replayCalls[0].provider, "stripe");
  assert.equal(replayCalls[0].eventPayload.id, "evt_stripe_failed");
});
