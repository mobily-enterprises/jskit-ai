import { parseUnixEpochSeconds, toNullableString, toSafeMetadata } from "./webhookProjection.utils.js";

function buildPurchaseDedupeKey({
  provider,
  providerPaymentId,
  providerInvoiceId,
  providerEventId
}) {
  const normalizedProvider = String(provider || "").trim().toLowerCase() || "stripe";

  // Prefer the strongest provider identifier first so duplicate webhook deliveries
  // for the same confirmed payment collapse into one purchase row.
  const paymentId = toNullableString(providerPaymentId);
  if (paymentId) {
    return `${normalizedProvider}:payment:${paymentId}`;
  }

  const invoiceId = toNullableString(providerInvoiceId);
  if (invoiceId) {
    return `${normalizedProvider}:invoice:${invoiceId}`;
  }

  const eventId = toNullableString(providerEventId);
  if (eventId) {
    return `${normalizedProvider}:event:${eventId}`;
  }

  return null;
}

async function recordConfirmedPurchaseForInvoicePaid({
  billingRepository,
  provider,
  trx,
  billableEntityId,
  providerInvoiceId,
  providerPaymentId,
  providerCustomerId,
  invoice,
  operationKey,
  billingEventId,
  providerCreatedAt,
  subscription,
  providerEventId = null
}) {
  if (!billingRepository || typeof billingRepository.upsertBillingPurchase !== "function") {
    return null;
  }

  const dedupeKey = buildPurchaseDedupeKey({
    provider,
    providerPaymentId,
    providerInvoiceId,
    providerEventId
  });
  if (!dedupeKey) {
    return null;
  }

  const paidAt = parseUnixEpochSeconds(invoice?.status_transitions?.paid_at);
  const invoiceMetadata = toSafeMetadata(invoice?.metadata);
  const purchaseKind = subscription ? "subscription_invoice" : "one_off";

  return billingRepository.upsertBillingPurchase(
    {
      billableEntityId,
      provider,
      purchaseKind,
      status: "confirmed",
      amountMinor: Number(invoice?.amount_paid || invoice?.amount_due || 0),
      currency: String(invoice?.currency || "").toUpperCase(),
      quantity: 1,
      operationKey,
      providerCustomerId,
      providerCheckoutSessionId:
        toNullableString(invoiceMetadata.checkout_session_id) ||
        toNullableString(invoiceMetadata.provider_checkout_session_id),
      providerPaymentId,
      providerInvoiceId,
      billingEventId: billingEventId == null ? null : Number(billingEventId),
      displayName:
        toNullableString(invoiceMetadata.display_name) ||
        toNullableString(invoiceMetadata.item_name) ||
        (subscription ? "Subscription invoice" : "One-off purchase"),
      metadataJson: {
        invoiceStatus: String(invoice?.status || ""),
        subscriptionId: toNullableString(invoice?.subscription),
        eventSource: "webhook.invoice.paid"
      },
      dedupeKey,
      purchasedAt: paidAt || providerCreatedAt
    },
    { trx }
  );
}

export { buildPurchaseDedupeKey, recordConfirmedPurchaseForInvoicePaid };
