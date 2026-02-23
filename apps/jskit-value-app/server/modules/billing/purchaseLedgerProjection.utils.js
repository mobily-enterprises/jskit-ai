import {
  parseUnixEpochSeconds,
  resolveInvoicePrimaryLineDescription,
  resolveInvoicePrimaryPriceId,
  resolveInvoiceSubscriptionId,
  toNullableString,
  toSafeMetadata
} from "./webhookProjection.utils.js";

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

function toNormalizedProvider(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizePlanNameFromLineDescription(description) {
  const normalizedDescription = toNullableString(description);
  if (!normalizedDescription) {
    return null;
  }

  const quantityPattern = /^\s*\d+\s*[×x]\s*(.+?)(?:\s+\(at\s+.+\))?\s*$/i;
  const matched = normalizedDescription.match(quantityPattern);
  if (!matched) {
    return null;
  }

  return toNullableString(matched[1]);
}

async function resolvePlanNameForInvoice({
  billingRepository,
  provider,
  providerPriceId,
  subscription,
  trx
}) {
  const normalizedProvider = toNormalizedProvider(provider);
  const normalizedProviderPriceId = toNullableString(providerPriceId);

  if (normalizedProviderPriceId && typeof billingRepository.findPlanByCheckoutProviderPriceId === "function") {
    const mappedPlan = await billingRepository.findPlanByCheckoutProviderPriceId(
      {
        provider: normalizedProvider,
        providerPriceId: normalizedProviderPriceId
      },
      { trx }
    );
    if (mappedPlan?.name) {
      return String(mappedPlan.name);
    }
  }

  const subscriptionPlanId = Number(subscription?.planId || 0);
  if (subscriptionPlanId > 0 && typeof billingRepository.findPlanById === "function") {
    const subscriptionPlan = await billingRepository.findPlanById(subscriptionPlanId, { trx });
    if (subscriptionPlan?.name) {
      return String(subscriptionPlan.name);
    }
  }

  if (normalizedProviderPriceId && typeof billingRepository.listPlans === "function") {
    const plans = await billingRepository.listPlans({ trx });
    for (const plan of Array.isArray(plans) ? plans : []) {
      const corePrice = plan?.corePrice && typeof plan.corePrice === "object" ? plan.corePrice : null;
      const planProvider = toNormalizedProvider(corePrice?.provider);
      const planProviderPriceId = toNullableString(corePrice?.providerPriceId);
      if (planProvider === normalizedProvider && planProviderPriceId === normalizedProviderPriceId) {
        return toNullableString(plan?.name);
      }
    }
  }

  return null;
}

async function resolveOneOffProductNameForInvoice({ billingRepository, provider, providerPriceId, trx }) {
  const normalizedProvider = toNormalizedProvider(provider);
  const normalizedProviderPriceId = toNullableString(providerPriceId);
  if (!normalizedProviderPriceId || typeof billingRepository.listProducts !== "function") {
    return null;
  }

  const products = await billingRepository.listProducts({ trx });
  for (const product of Array.isArray(products) ? products : []) {
    if (!product || product.isActive === false) {
      continue;
    }
    const price = product.price && typeof product.price === "object" ? product.price : null;
    const productProvider = toNormalizedProvider(price?.provider);
    const productProviderPriceId = toNullableString(price?.providerPriceId);
    if (productProvider === normalizedProvider && productProviderPriceId === normalizedProviderPriceId) {
      return toNullableString(product.name);
    }
  }

  return null;
}

async function resolveInvoiceDisplayName({
  billingRepository,
  provider,
  invoice,
  invoiceMetadata,
  purchaseKind,
  subscription,
  trx
}) {
  const metadataDisplayName = toNullableString(invoiceMetadata.display_name) || toNullableString(invoiceMetadata.item_name);
  const providerPriceId = resolveInvoicePrimaryPriceId(invoice);
  const lineDescription = resolveInvoicePrimaryLineDescription(invoice);

  if (purchaseKind === "subscription_invoice") {
    const planNameFromCatalog = await resolvePlanNameForInvoice({
      billingRepository,
      provider,
      providerPriceId,
      subscription,
      trx
    });
    const parsedPlanName = normalizePlanNameFromLineDescription(lineDescription);
    const candidatePlanName = planNameFromCatalog || metadataDisplayName || parsedPlanName;
    if (candidatePlanName) {
      return `Plan charge - ${candidatePlanName}`;
    }
    return "Plan charge";
  }

  const productNameFromCatalog = await resolveOneOffProductNameForInvoice({
    billingRepository,
    provider,
    providerPriceId,
    trx
  });
  return (
    metadataDisplayName ||
    productNameFromCatalog ||
    toNullableString(lineDescription) ||
    toNullableString(invoice?.description) ||
    "One-off purchase"
  );
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
  const invoiceSubscriptionId = resolveInvoiceSubscriptionId(invoice);
  const providerPriceId = resolveInvoicePrimaryPriceId(invoice);
  const primaryLineDescription = resolveInvoicePrimaryLineDescription(invoice);
  const invoiceMetadata = toSafeMetadata(invoice?.metadata);
  const purchaseKind = invoiceSubscriptionId ? "subscription_invoice" : "one_off";
  const displayName = await resolveInvoiceDisplayName({
    billingRepository,
    provider,
    invoice,
    invoiceMetadata,
    purchaseKind,
    subscription,
    trx
  });

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
      displayName,
      metadataJson: {
        invoiceStatus: String(invoice?.status || ""),
        billingReason: toNullableString(invoice?.billing_reason),
        subscriptionId: invoiceSubscriptionId,
        providerPriceId,
        lineDescription: toNullableString(primaryLineDescription),
        eventSource: "webhook.invoice.paid"
      },
      dedupeKey,
      purchasedAt: paidAt || providerCreatedAt
    },
    { trx }
  );
}

export { buildPurchaseDedupeKey, recordConfirmedPurchaseForInvoicePaid };
