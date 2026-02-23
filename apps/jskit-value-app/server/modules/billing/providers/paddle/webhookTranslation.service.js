import { BILLING_PROVIDER_PADDLE } from "../../constants.js";
import {
  assertBillingWebhookTranslator,
  shouldProcessCanonicalBillingWebhookEvent
} from "../shared/webhookTranslation.contract.js";

const PADDLE_EVENT_TYPE_MAP = Object.freeze({
  "transaction.completed": "invoice.paid",
  "transaction.paid": "invoice.paid",
  "transaction.payment_failed": "invoice.payment_failed",
  "transaction.failed": "invoice.payment_failed",
  "subscription.created": "customer.subscription.created",
  "subscription.updated": "customer.subscription.updated",
  "subscription.canceled": "customer.subscription.deleted",
  "subscription.cancelled": "customer.subscription.deleted"
});

function toNullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toUnixEpochSeconds(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    if (parsed > 1_000_000_000_000) {
      return Math.floor(parsed / 1000);
    }

    return Math.floor(parsed);
  }

  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time) || time < 0) {
    return null;
  }

  return Math.floor(time / 1000);
}

function toMinorUnits(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return 0;
  }

  if (/^-?\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100);
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[String(key)] = String(entry == null ? "" : entry);
  }

  return output;
}

function normalizePaddleSubscriptionStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "incomplete";
  }

  if (normalized === "active" || normalized === "trialing") {
    return normalized;
  }
  if (normalized === "past_due") {
    return "past_due";
  }
  if (normalized === "paused") {
    return "paused";
  }
  if (normalized === "canceled" || normalized === "cancelled") {
    return "canceled";
  }

  return "incomplete";
}

function mapPaddleEventType(rawType) {
  const normalizedType = String(rawType || "")
    .trim()
    .toLowerCase();
  return PADDLE_EVENT_TYPE_MAP[normalizedType] || "";
}

function normalizePaddleEventToCanonical(rawEvent) {
  const normalized = rawEvent && typeof rawEvent === "object" ? rawEvent : {};
  const rawType = String(normalized?.type || "").trim();
  const mappedType = mapPaddleEventType(rawType);
  const created =
    toUnixEpochSeconds(normalized?.created) ||
    toUnixEpochSeconds(normalized?.raw?.occurred_at) ||
    Math.floor(Date.now() / 1000);

  const rawObject =
    normalized?.data?.object && typeof normalized.data.object === "object" ? normalized.data.object : {};
  const metadata = normalizeMetadata(rawObject.custom_data || rawObject.metadata);

  if (mappedType.startsWith("customer.subscription.")) {
    const rawItems = Array.isArray(rawObject.items) ? rawObject.items : [];
    return {
      id: String(normalized?.id || "").trim(),
      type: mappedType,
      created,
      data: {
        object: {
          id: toNullableString(rawObject.id || rawObject.subscription_id || rawObject?.subscription?.id),
          status: normalizePaddleSubscriptionStatus(rawObject.status),
          customer: toNullableString(rawObject.customer_id || rawObject?.customer?.id),
          created: toUnixEpochSeconds(rawObject.started_at || rawObject.created_at) || created,
          current_period_end: toUnixEpochSeconds(rawObject.next_billed_at || rawObject?.current_billing_period?.ends_at),
          trial_end: toUnixEpochSeconds(rawObject.trial_end_at || rawObject?.trial_period?.ends_at),
          canceled_at: toUnixEpochSeconds(rawObject.canceled_at || rawObject.cancelled_at),
          cancel_at_period_end:
            String(rawObject?.scheduled_change?.action || "")
              .trim()
              .toLowerCase() === "cancel",
          ended_at: toUnixEpochSeconds(rawObject.ended_at || rawObject.canceled_at || rawObject.cancelled_at),
          customer_email: toNullableString(rawObject?.customer?.email),
          metadata,
          items: {
            data: rawItems.map((item) => ({
              id: toNullableString(item?.id),
              quantity: Number(item?.quantity || 1),
              deleted: false,
              metadata: normalizeMetadata(item?.custom_data || item?.metadata),
              price: {
                id: toNullableString(item?.price_id || item?.price?.id)
              }
            }))
          }
        }
      },
      raw: normalized?.raw || normalized
    };
  }

  if (mappedType === "invoice.paid" || mappedType === "invoice.payment_failed") {
    const totals = rawObject?.details?.totals && typeof rawObject.details.totals === "object" ? rawObject.details.totals : {};
    const totalMinorUnits = toMinorUnits(totals.total || totals.grand_total || rawObject.amount);
    const isPaid = mappedType === "invoice.paid";
    const amountPaidMinor = isPaid ? totalMinorUnits : 0;
    const amountDueMinor = isPaid ? 0 : totalMinorUnits;
    return {
      id: String(normalized?.id || "").trim(),
      type: mappedType,
      created,
      data: {
        object: {
          id: toNullableString(rawObject.id),
          subscription: toNullableString(rawObject.subscription_id || rawObject?.subscription?.id),
          customer: toNullableString(rawObject.customer_id || rawObject?.customer?.id),
          status: isPaid ? "paid" : "open",
          currency: toNullableString(totals.currency_code || rawObject.currency_code || rawObject.currency),
          total: totalMinorUnits,
          amount_paid: amountPaidMinor,
          amount_due: amountDueMinor,
          amount_remaining: Math.max(0, amountDueMinor - amountPaidMinor),
          attempt_count: Number(rawObject.attempt_count || 1),
          next_payment_attempt: toUnixEpochSeconds(rawObject.next_payment_attempt_at || rawObject.next_billed_at),
          customer_email: toNullableString(rawObject?.customer?.email),
          metadata,
          created: toUnixEpochSeconds(rawObject.billed_at || rawObject.created_at || rawObject.updated_at) || created
        }
      },
      raw: normalized?.raw || normalized
    };
  }

  return {
    id: String(normalized?.id || "").trim(),
    type: mappedType || rawType,
    created,
    data: {
      object: {
        ...rawObject,
        metadata
      }
    },
    raw: normalized?.raw || normalized
  };
}

function createService() {
  const translator = {
    provider: BILLING_PROVIDER_PADDLE,
    toCanonicalEvent(providerEvent) {
      return normalizePaddleEventToCanonical(providerEvent);
    },
    supportsCanonicalEventType(eventType) {
      return shouldProcessCanonicalBillingWebhookEvent(eventType);
    }
  };

  return assertBillingWebhookTranslator(translator, {
    name: "paddleBillingWebhookTranslator"
  });
}

const __testables = {
  mapPaddleEventType,
  normalizePaddleEventToCanonical,
  normalizePaddleSubscriptionStatus,
  toMinorUnits,
  toNullableString,
  toUnixEpochSeconds,
  normalizeMetadata
};

export {
  PADDLE_EVENT_TYPE_MAP,
  mapPaddleEventType,
  normalizePaddleEventToCanonical,
  createService,
  __testables
};
