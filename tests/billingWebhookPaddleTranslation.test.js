import assert from "node:assert/strict";
import test from "node:test";

import {
  mapPaddleEventType,
  normalizePaddleEventToCanonical
} from "../server/modules/billing/providers/paddle/webhookTranslation.service.js";

test("billing webhook paddle translation maps supported event types to canonical billing events", () => {
  assert.equal(mapPaddleEventType("transaction.completed"), "invoice.paid");
  assert.equal(mapPaddleEventType("transaction.payment_failed"), "invoice.payment_failed");
  assert.equal(mapPaddleEventType("subscription.created"), "customer.subscription.created");
  assert.equal(mapPaddleEventType("subscription.updated"), "customer.subscription.updated");
  assert.equal(mapPaddleEventType("subscription.canceled"), "customer.subscription.deleted");
});

test("billing webhook paddle translation normalizes subscription payload into canonical shape", () => {
  const canonical = normalizePaddleEventToCanonical({
    id: "evt_123",
    type: "subscription.updated",
    created: 1761000000,
    data: {
      object: {
        id: "sub_123",
        status: "active",
        customer_id: "ctm_123",
        custom_data: {
          operation_key: "op_123",
          billable_entity_id: "77"
        },
        items: [
          {
            id: "si_123",
            price_id: "pri_123",
            quantity: 3
          }
        ]
      }
    }
  });

  assert.equal(canonical.type, "customer.subscription.updated");
  assert.equal(canonical.data.object.id, "sub_123");
  assert.equal(canonical.data.object.customer, "ctm_123");
  assert.equal(canonical.data.object.metadata.operation_key, "op_123");
  assert.equal(canonical.data.object.items.data[0].price.id, "pri_123");
});

test("billing webhook paddle translation normalizes transaction payload into invoice canonical shape", () => {
  const canonical = normalizePaddleEventToCanonical({
    id: "evt_456",
    type: "transaction.completed",
    created: 1761000000,
    data: {
      object: {
        id: "txn_456",
        status: "completed",
        customer_id: "ctm_9",
        subscription_id: "sub_9",
        details: {
          totals: {
            total: "12.34",
            currency_code: "USD"
          }
        },
        custom_data: {
          operation_key: "op_txn_9"
        }
      }
    }
  });

  assert.equal(canonical.type, "invoice.paid");
  assert.equal(canonical.data.object.id, "txn_456");
  assert.equal(canonical.data.object.total, 1234);
  assert.equal(canonical.data.object.amount_paid, 1234);
  assert.equal(canonical.data.object.metadata.operation_key, "op_txn_9");
});
