import { AppError } from "../../lib/errors.js";
import {
  BILLING_CHECKOUT_SESSION_STATUS,
  BILLING_DEFAULT_PROVIDER,
  BILLING_IDEMPOTENCY_STATUS,
} from "./constants.js";
import {
  hasSameTimestampOrderingConflict,
  isIncomingEventOlder,
  isSubscriptionStatusCurrent,
  normalizeProviderSubscriptionStatus,
  parseUnixEpochSeconds,
  sortDuplicateCandidatesForCanonicalSelection,
  toNullableString,
  toPositiveInteger,
  toSafeMetadata
} from "./webhookProjection.utils.js";
import { recordConfirmedPurchaseForInvoicePaid } from "./purchaseLedgerProjection.utils.js";

const DUPLICATE_SELECTION_ALGORITHM_VERSION = "dup_canonical_v1";

function createService(options = {}) {
  const {
    billingRepository,
    billingCheckoutSessionService,
    billingProviderAdapter,
    resolveBillableEntityIdFromCustomerId,
    lockEntityAggregate,
    maybeFinalizePendingCheckoutIdempotency,
    observabilityService = null
  } = options;
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (!billingCheckoutSessionService) {
    throw new Error("billingCheckoutSessionService is required.");
  }
  if (typeof resolveBillableEntityIdFromCustomerId !== "function") {
    throw new Error("resolveBillableEntityIdFromCustomerId is required.");
  }
  if (typeof lockEntityAggregate !== "function") {
    throw new Error("lockEntityAggregate is required.");
  }
  if (typeof maybeFinalizePendingCheckoutIdempotency !== "function") {
    throw new Error("maybeFinalizePendingCheckoutIdempotency is required.");
  }
  const providerAdapter = billingProviderAdapter;
  if (!providerAdapter || typeof providerAdapter.retrieveSubscription !== "function") {
    throw new Error("billingProviderAdapter.retrieveSubscription is required.");
  }
  if (typeof providerAdapter.retrieveInvoice !== "function") {
    throw new Error("billingProviderAdapter.retrieveInvoice is required.");
  }
  const activeProvider =
    String(providerAdapter?.provider || BILLING_DEFAULT_PROVIDER)
      .trim()
      .toLowerCase() || BILLING_DEFAULT_PROVIDER;

  function recordGuardrail(code, context = {}) {
    const payload = {
      code,
      ...(context && typeof context === "object" ? context : {})
    };

    if (observabilityService && typeof observabilityService.recordBillingGuardrail === "function") {
      observabilityService.recordBillingGuardrail(payload);
      return;
    }

    if (!observabilityService || typeof observabilityService.recordDbError !== "function") {
      return;
    }

    observabilityService.recordDbError({
      code
    });
  }

  async function fetchAuthoritativeSubscription(providerSubscriptionId) {
    const normalizedProviderSubscriptionId = toNullableString(providerSubscriptionId);
    if (!normalizedProviderSubscriptionId) {
      return null;
    }

    try {
      return await providerAdapter.retrieveSubscription({
        subscriptionId: normalizedProviderSubscriptionId
      });
    } catch {
      return null;
    }
  }

  async function fetchAuthoritativeInvoice(providerInvoiceId) {
    const normalizedProviderInvoiceId = toNullableString(providerInvoiceId);
    if (!normalizedProviderInvoiceId) {
      return null;
    }

    try {
      return await providerAdapter.retrieveInvoice({
        invoiceId: normalizedProviderInvoiceId
      });
    } catch {
      return null;
    }
  }

  async function resolveBillableEntityIdFromSubscription(subscription, trx) {
    const metadata = toSafeMetadata(subscription?.metadata);
    const metadataEntityId = toPositiveInteger(metadata.billable_entity_id);
    if (metadataEntityId) {
      return metadataEntityId;
    }

    return resolveBillableEntityIdFromCustomerId(subscription?.customer, trx);
  }

  async function resolvePlanMappingFromSubscriptionItems(subscriptionItems, trx, existingPlanId = null) {
    const priceByProviderPriceId = new Map();
    let resolvedPlanId = existingPlanId || null;

    let planByProviderPriceId = null;
    if (typeof billingRepository.listPlans === "function") {
      const plans = await billingRepository.listPlans({ trx });
      planByProviderPriceId = new Map();
      for (const plan of plans) {
        const corePrice = plan?.corePrice && typeof plan.corePrice === "object" ? plan.corePrice : null;
        const providerPriceId = toNullableString(corePrice?.providerPriceId);
        const provider = toNullableString(corePrice?.provider);
        if (!providerPriceId || provider !== activeProvider) {
          continue;
        }

        planByProviderPriceId.set(providerPriceId, plan);
      }
    }

    for (const subscriptionItem of subscriptionItems) {
      const providerPriceId = toNullableString(subscriptionItem?.price?.id);
      if (!providerPriceId) {
        continue;
      }

      const mappedPlan =
        typeof billingRepository.findPlanByCheckoutProviderPriceId === "function"
          ? await billingRepository.findPlanByCheckoutProviderPriceId(
              {
                provider: activeProvider,
                providerPriceId
              },
              { trx }
            )
          : planByProviderPriceId?.get(providerPriceId) || null;
      if (!mappedPlan) {
        continue;
      }

      priceByProviderPriceId.set(providerPriceId, {
        planId: Number(mappedPlan.id),
        billingComponent: "base",
        usageType: "licensed",
        id: null
      });

      if (resolvedPlanId == null) {
        resolvedPlanId = Number(mappedPlan.id);
      } else if (Number(resolvedPlanId) !== Number(mappedPlan.id)) {
        throw new AppError(409, "Subscription price mapping spans multiple plans.");
      }
    }

    return {
      resolvedPlanId,
      priceByProviderPriceId
    };
  }

  async function updateSubscriptionItemsProjection({
    subscriptionRow,
    subscriptionItems,
    priceByProviderPriceId,
    providerCreatedAt,
    providerEventId,
    ignoreOrderingGuards = false,
    trx
  }) {
    void subscriptionRow;
    void subscriptionItems;
    void priceByProviderPriceId;
    void providerCreatedAt;
    void providerEventId;
    void ignoreOrderingGuards;
    void trx;
  }

  async function applyCanonicalCurrentSubscriptionSelection({ billableEntityId, operationKey, providerEventId, trx }) {
    const allSubscriptions = await billingRepository.lockSubscriptionsForEntity(billableEntityId, {
      trx,
      forUpdate: true
    });

    const nonTerminal = allSubscriptions.filter((row) => isSubscriptionStatusCurrent(row.status));
    if (nonTerminal.length < 1) {
      await billingRepository.clearCurrentSubscriptionFlagsForEntity(billableEntityId, { trx });
      return null;
    }

    const currentMarked = nonTerminal.filter((row) => row.isCurrent);
    const usedCanonicalFallback = currentMarked.length !== 1;
    const canonical =
      currentMarked.length === 1
        ? currentMarked[0]
        : sortDuplicateCandidatesForCanonicalSelection(nonTerminal)[0] || null;

    if (!canonical) {
      return null;
    }

    await billingRepository.clearCurrentSubscriptionFlagsForEntity(billableEntityId, { trx });

    const canonicalCurrentRow = await billingRepository.upsertSubscription(
      {
        billableEntityId: canonical.billableEntityId,
        planId: canonical.planId,
        billingCustomerId: canonical.billingCustomerId,
        provider: canonical.provider,
        providerSubscriptionId: canonical.providerSubscriptionId,
        status: canonical.status,
        providerSubscriptionCreatedAt: canonical.providerSubscriptionCreatedAt,
        currentPeriodEnd: canonical.currentPeriodEnd,
        trialEnd: canonical.trialEnd,
        canceledAt: canonical.canceledAt,
        cancelAtPeriodEnd: canonical.cancelAtPeriodEnd,
        endedAt: canonical.endedAt,
        isCurrent: true,
        lastProviderEventCreatedAt: canonical.lastProviderEventCreatedAt,
        lastProviderEventId: canonical.lastProviderEventId,
        metadataJson: canonical.metadataJson
      },
      { trx }
    );

    const duplicates = nonTerminal.filter(
      (row) => row.providerSubscriptionId !== canonicalCurrentRow.providerSubscriptionId
    );

    if (duplicates.length > 0) {
      recordGuardrail("BILLING_DUPLICATE_ACTIVE_SUBSCRIPTIONS_DETECTED", {
        billableEntityId,
        measure: "count",
        value: duplicates.length
      });
    }
    if (usedCanonicalFallback) {
      recordGuardrail("BILLING_CANONICAL_SELECTION_FALLBACK", {
        billableEntityId,
        measure: "count",
        value: 1
      });
    }

    for (const duplicate of duplicates) {
      await billingRepository.upsertSubscriptionRemediation(
        {
          billableEntityId,
          provider: activeProvider,
          operationKey,
          providerEventId,
          canonicalProviderSubscriptionId: canonicalCurrentRow.providerSubscriptionId,
          canonicalSubscriptionId: canonicalCurrentRow.id,
          duplicateProviderSubscriptionId: duplicate.providerSubscriptionId,
          action: "cancel_duplicate_subscription",
          status: "pending",
          selectionAlgorithmVersion: DUPLICATE_SELECTION_ALGORITHM_VERSION
        },
        { trx }
      );
    }

    return canonicalCurrentRow;
  }

  async function reconcileCheckoutSessionFromSubscription({
    providerSubscriptionId,
    operationKey,
    providerCreatedAt,
    providerEventId,
    ignoreOrderingGuards = false,
    trx
  }) {
    let checkoutSession = null;

    if (operationKey) {
      checkoutSession = await billingRepository.findCheckoutSessionByProviderOperationKey(
        {
          provider: activeProvider,
          operationKey
        },
        {
          trx,
          forUpdate: true
        }
      );
    }

    if (!checkoutSession && providerSubscriptionId) {
      checkoutSession = await billingRepository.findCheckoutSessionByProviderSubscriptionId(
        {
          provider: activeProvider,
          providerSubscriptionId
        },
        {
          trx,
          forUpdate: true
        }
      );
    }

    if (!checkoutSession) {
      return null;
    }

    if (
      !ignoreOrderingGuards &&
      isIncomingEventOlder(checkoutSession.lastProviderEventCreatedAt, providerCreatedAt, {
        existingProviderEventId: checkoutSession.lastProviderEventId,
        incomingProviderEventId: providerEventId
      })
    ) {
      return checkoutSession;
    }

    if (
      checkoutSession.status === BILLING_CHECKOUT_SESSION_STATUS.OPEN ||
      checkoutSession.status === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION ||
      checkoutSession.status === BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING
    ) {
      return billingCheckoutSessionService.markCheckoutSessionReconciled({
        providerCheckoutSessionId: checkoutSession.providerCheckoutSessionId,
        operationKey: checkoutSession.operationKey,
        providerSubscriptionId,
        providerEventCreatedAt: providerCreatedAt,
        providerEventId,
        provider: activeProvider,
        trx
      });
    }

    return checkoutSession;
  }

  async function projectSubscription(subscription, eventContext) {
    const { trx, providerCreatedAt, providerEventId } = eventContext;

    const providerSubscriptionId = toNullableString(subscription?.id);
    if (!providerSubscriptionId) {
      throw new AppError(400, "Provider subscription payload missing id.");
    }

    let projectionSubscription = subscription;
    let projectionProviderCreatedAt = providerCreatedAt;
    let projectionProviderEventId = providerEventId;
    let usedAuthoritativeFallback = false;

    const metadata = toSafeMetadata(projectionSubscription?.metadata);
    const operationKey = toNullableString(metadata.operation_key);
    const billableEntityId = await resolveBillableEntityIdFromSubscription(subscription, trx);
    if (!billableEntityId) {
      throw new AppError(409, "Unable to correlate subscription to billable entity.");
    }

    const { idempotencyRow } = await lockEntityAggregate({
      billableEntityId,
      operationKey,
      trx
    });

    const existingSubscription = await billingRepository.findSubscriptionByProviderSubscriptionId(
      {
        provider: activeProvider,
        providerSubscriptionId
      },
      {
        trx,
        forUpdate: true
      }
    );
    const olderThanExisting = isIncomingEventOlder(existingSubscription?.lastProviderEventCreatedAt, providerCreatedAt, {
      existingProviderEventId: existingSubscription?.lastProviderEventId,
      incomingProviderEventId: providerEventId
    });
    if (olderThanExisting) {
      const sameTimestampConflict = hasSameTimestampOrderingConflict(
        existingSubscription?.lastProviderEventCreatedAt,
        providerCreatedAt,
        {
          existingProviderEventId: existingSubscription?.lastProviderEventId,
          incomingProviderEventId: providerEventId
        }
      );
      if (!sameTimestampConflict) {
        return;
      }

      const authoritativeSubscription = await fetchAuthoritativeSubscription(providerSubscriptionId);
      if (!authoritativeSubscription) {
        return;
      }

      projectionSubscription = authoritativeSubscription;
      const existingProviderCreatedAt = new Date(existingSubscription.lastProviderEventCreatedAt || 0);
      projectionProviderCreatedAt = Number.isNaN(existingProviderCreatedAt.getTime())
        ? providerCreatedAt
        : existingProviderCreatedAt;
      projectionProviderEventId = toNullableString(existingSubscription.lastProviderEventId) || providerEventId;
      usedAuthoritativeFallback = true;
    }

    const projectionMetadata = toSafeMetadata(projectionSubscription?.metadata);
    const projectionOperationKey = toNullableString(projectionMetadata.operation_key) || operationKey;

    const customerId = toNullableString(projectionSubscription?.customer);
    if (!customerId) {
      throw new AppError(409, "Subscription payload missing customer id.");
    }

    const customer = await billingRepository.upsertCustomer(
      {
        billableEntityId,
        provider: activeProvider,
        providerCustomerId: customerId,
        email:
          toNullableString(projectionSubscription?.customer_email) ||
          toNullableString(projectionSubscription?.customer_details?.email),
        metadataJson: projectionMetadata
      },
      { trx }
    );

    const subscriptionItems = Array.isArray(projectionSubscription?.items?.data) ? projectionSubscription.items.data : [];
    const { resolvedPlanId, priceByProviderPriceId } = await resolvePlanMappingFromSubscriptionItems(
      subscriptionItems,
      trx,
      existingSubscription?.planId || null
    );
    if (!resolvedPlanId) {
      throw new AppError(409, "Unable to map subscription price to billing plan.");
    }

    const status = normalizeProviderSubscriptionStatus(projectionSubscription?.status);

    const subscriptionRow = await billingRepository.upsertSubscription(
      {
        billableEntityId,
        planId: resolvedPlanId,
        billingCustomerId: customer.id,
        provider: activeProvider,
        providerSubscriptionId,
        status,
        providerSubscriptionCreatedAt:
          existingSubscription?.providerSubscriptionCreatedAt ||
          parseUnixEpochSeconds(projectionSubscription?.created) ||
          projectionProviderCreatedAt,
        currentPeriodEnd: parseUnixEpochSeconds(projectionSubscription?.current_period_end),
        trialEnd: parseUnixEpochSeconds(projectionSubscription?.trial_end),
        canceledAt: parseUnixEpochSeconds(projectionSubscription?.canceled_at),
        cancelAtPeriodEnd: Boolean(projectionSubscription?.cancel_at_period_end),
        endedAt: parseUnixEpochSeconds(projectionSubscription?.ended_at),
        isCurrent: isSubscriptionStatusCurrent(status),
        lastProviderEventCreatedAt: projectionProviderCreatedAt,
        lastProviderEventId: projectionProviderEventId,
        metadataJson: projectionMetadata
      },
      { trx }
    );

    await updateSubscriptionItemsProjection({
      subscriptionRow,
      subscriptionItems,
      priceByProviderPriceId,
      providerCreatedAt: projectionProviderCreatedAt,
      providerEventId: projectionProviderEventId,
      ignoreOrderingGuards: usedAuthoritativeFallback,
      trx
    });

    await applyCanonicalCurrentSubscriptionSelection({
      billableEntityId,
      operationKey: projectionOperationKey,
      providerEventId: projectionProviderEventId,
      trx
    });

    const reconciledSession = await reconcileCheckoutSessionFromSubscription({
      providerSubscriptionId: subscriptionRow.providerSubscriptionId,
      operationKey: projectionOperationKey,
      providerCreatedAt: projectionProviderCreatedAt,
      providerEventId: projectionProviderEventId,
      ignoreOrderingGuards: usedAuthoritativeFallback,
      trx
    });

    if (reconciledSession && idempotencyRow && idempotencyRow.status === BILLING_IDEMPOTENCY_STATUS.PENDING) {
      await maybeFinalizePendingCheckoutIdempotency({
        idempotencyRow,
        session: {
          id: reconciledSession.providerCheckoutSessionId,
          status:
            reconciledSession.status === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_RECONCILED
              ? "complete"
              : reconciledSession.status === BILLING_CHECKOUT_SESSION_STATUS.EXPIRED
                ? "expired"
                : "open",
          url: reconciledSession.checkoutUrl,
          expires_at: reconciledSession.expiresAt
            ? Math.floor(new Date(reconciledSession.expiresAt).getTime() / 1000)
            : null,
          customer: reconciledSession.providerCustomerId,
          subscription: reconciledSession.providerSubscriptionId
        },
        billableEntityId,
        operationKey: idempotencyRow.operationKey,
        trx
      });
    }
  }

  async function projectInvoiceAndPayment(invoice, eventContext) {
    const { trx, providerCreatedAt, providerEventId, eventType, billingEventId } = eventContext;

    let projectionInvoice = invoice;
    let projectionProviderCreatedAt = providerCreatedAt;
    let projectionProviderEventId = providerEventId;
    let usedAuthoritativeFallback = false;

    const providerInvoiceId = toNullableString(projectionInvoice?.id);
    if (!providerInvoiceId) {
      throw new AppError(400, "Provider invoice payload missing id.");
    }

    let providerSubscriptionId = toNullableString(projectionInvoice?.subscription);
    const providerCustomerId = toNullableString(projectionInvoice?.customer);
    let subscription = null;
    let resolvedBillableEntityId =
      toPositiveInteger(eventContext?.billableEntityId) ||
      toPositiveInteger(toSafeMetadata(projectionInvoice?.metadata).billable_entity_id);

    if (providerSubscriptionId) {
      subscription = await billingRepository.findSubscriptionByProviderSubscriptionId(
        {
          provider: activeProvider,
          providerSubscriptionId
        },
        {
          trx,
          forUpdate: true
        }
      );
      if (subscription) {
        resolvedBillableEntityId = subscription.billableEntityId;
      }
    }

    if (!resolvedBillableEntityId && providerCustomerId) {
      const customerProbe = await billingRepository.findCustomerByProviderCustomerId(
        {
          provider: activeProvider,
          providerCustomerId
        },
        { trx }
      );
      if (customerProbe) {
        resolvedBillableEntityId = customerProbe.billableEntityId;
      }
    }

    if (!resolvedBillableEntityId) {
      throw new AppError(409, "Unable to correlate invoice to billable entity.");
    }

    await lockEntityAggregate({
      billableEntityId: resolvedBillableEntityId,
      operationKey: toNullableString(toSafeMetadata(projectionInvoice?.metadata).operation_key),
      trx
    });

    if (providerSubscriptionId) {
      subscription = await billingRepository.findSubscriptionByProviderSubscriptionId(
        {
          provider: activeProvider,
          providerSubscriptionId
        },
        {
          trx,
          forUpdate: true
        }
      );
      if (subscription) {
        resolvedBillableEntityId = subscription.billableEntityId;
      }
    }

    const existingInvoice = await billingRepository.findInvoiceByProviderInvoiceId(
      {
        provider: activeProvider,
        providerInvoiceId
      },
      {
        trx,
        forUpdate: true
      }
    );
    if (
      isIncomingEventOlder(existingInvoice?.lastProviderEventCreatedAt, providerCreatedAt, {
        existingProviderEventId: existingInvoice?.lastProviderEventId,
        incomingProviderEventId: providerEventId
      })
    ) {
      const sameTimestampConflict = hasSameTimestampOrderingConflict(
        existingInvoice?.lastProviderEventCreatedAt,
        providerCreatedAt,
        {
          existingProviderEventId: existingInvoice?.lastProviderEventId,
          incomingProviderEventId: providerEventId
        }
      );

      if (!sameTimestampConflict) {
        return;
      }

      const authoritativeInvoice = await fetchAuthoritativeInvoice(providerInvoiceId);
      if (!authoritativeInvoice) {
        return;
      }

      projectionInvoice = authoritativeInvoice;
      const existingProviderCreatedAt = new Date(existingInvoice.lastProviderEventCreatedAt || 0);
      projectionProviderCreatedAt = Number.isNaN(existingProviderCreatedAt.getTime())
        ? providerCreatedAt
        : existingProviderCreatedAt;
      projectionProviderEventId = toNullableString(existingInvoice.lastProviderEventId) || providerEventId;
      usedAuthoritativeFallback = true;
      providerSubscriptionId = toNullableString(projectionInvoice?.subscription);
      if (providerSubscriptionId) {
        subscription = await billingRepository.findSubscriptionByProviderSubscriptionId(
          {
            provider: activeProvider,
            providerSubscriptionId
          },
          {
            trx,
            forUpdate: true
          }
        );
      } else {
        subscription = null;
      }

      const fallbackMetadata = toSafeMetadata(projectionInvoice?.metadata);
      resolvedBillableEntityId =
        subscription?.billableEntityId ||
        toPositiveInteger(fallbackMetadata.billable_entity_id) ||
        toPositiveInteger(eventContext?.billableEntityId);
      if (!resolvedBillableEntityId) {
        throw new AppError(409, "Unable to correlate invoice to billable entity.");
      }
    }

    const projectionMetadata = toSafeMetadata(projectionInvoice?.metadata);
    const projectionProviderCustomerId = toNullableString(projectionInvoice?.customer) || providerCustomerId;

    let customer = null;
    if (projectionProviderCustomerId) {
      const customerByProviderId = await billingRepository.findCustomerByProviderCustomerId(
        {
          provider: activeProvider,
          providerCustomerId: projectionProviderCustomerId
        },
        {
          trx,
          forUpdate: true
        }
      );

      if (
        customerByProviderId &&
        Number(customerByProviderId.billableEntityId) !== Number(resolvedBillableEntityId)
      ) {
        throw new AppError(409, "Invoice customer ownership does not match billable entity.");
      }

      customer = customerByProviderId || null;
    }

    if (!customer) {
      customer = await billingRepository.findCustomerByEntityProvider(
        {
          billableEntityId: resolvedBillableEntityId,
          provider: activeProvider
        },
        {
          trx,
          forUpdate: true
        }
      );
    }

    if (!customer && projectionProviderCustomerId) {
      customer = await billingRepository.upsertCustomer(
        {
          billableEntityId: resolvedBillableEntityId,
          provider: activeProvider,
          providerCustomerId: projectionProviderCustomerId,
          email:
            toNullableString(projectionInvoice?.customer_email) ||
            toNullableString(projectionInvoice?.customer_details?.email),
          metadataJson: projectionMetadata
        },
        { trx }
      );
    }

    if (!customer && subscription) {
      customer = await billingRepository.findCustomerById(subscription.billingCustomerId, { trx });
    }

    if (!customer?.id) {
      throw new AppError(409, "Unable to correlate invoice to billing customer.");
    }

    const invoiceRow = await billingRepository.upsertInvoice(
      {
        subscriptionId: subscription ? subscription.id : null,
        billableEntityId: resolvedBillableEntityId,
        billingCustomerId: customer.id,
        provider: activeProvider,
        providerInvoiceId,
        status: String(projectionInvoice?.status || ""),
        amountDueMinor: Number(projectionInvoice?.amount_due || 0),
        amountPaidMinor: Number(projectionInvoice?.amount_paid || 0),
        amountRemainingMinor: Number(projectionInvoice?.amount_remaining || 0),
        currency: String(projectionInvoice?.currency || "").toUpperCase(),
        issuedAt: parseUnixEpochSeconds(projectionInvoice?.created),
        dueAt: parseUnixEpochSeconds(projectionInvoice?.due_date),
        paidAt: parseUnixEpochSeconds(projectionInvoice?.status_transitions?.paid_at),
        lastProviderEventCreatedAt: projectionProviderCreatedAt,
        lastProviderEventId: projectionProviderEventId,
        metadataJson: projectionMetadata
      },
      { trx }
    );

    if (eventType === "invoice.paid" || eventType === "invoice.payment_failed") {
      const providerPaymentId =
        toNullableString(projectionInvoice?.payment_intent) ||
        toNullableString(projectionInvoice?.charge) ||
        `${providerInvoiceId}:${eventType}`;

      const existingPayment = await billingRepository.findPaymentByProviderPaymentId(
        {
          provider: activeProvider,
          providerPaymentId
        },
        {
          trx,
          forUpdate: true
        }
      );
      if (
        !usedAuthoritativeFallback &&
        isIncomingEventOlder(existingPayment?.lastProviderEventCreatedAt, projectionProviderCreatedAt, {
          existingProviderEventId: existingPayment?.lastProviderEventId,
          incomingProviderEventId: projectionProviderEventId
        })
      ) {
        return;
      }

      await billingRepository.upsertPayment(
        {
          invoiceId: invoiceRow.id,
          provider: activeProvider,
          providerPaymentId,
          type: "invoice_payment",
          status: eventType === "invoice.paid" ? "paid" : "failed",
          amountMinor: Number(projectionInvoice?.amount_paid || projectionInvoice?.amount_due || 0),
          currency: String(projectionInvoice?.currency || "").toUpperCase(),
          paidAt: parseUnixEpochSeconds(projectionInvoice?.status_transitions?.paid_at),
          lastProviderEventCreatedAt: projectionProviderCreatedAt,
          lastProviderEventId: projectionProviderEventId,
          metadataJson: {
            invoiceId: providerInvoiceId,
            eventType
          }
        },
        { trx }
      );

      if (eventType === "invoice.paid") {
        await recordConfirmedPurchaseForInvoicePaid(
          {
            billingRepository,
            provider: activeProvider,
            trx,
            billableEntityId: resolvedBillableEntityId,
            providerInvoiceId,
            providerPaymentId,
            providerCustomerId: projectionProviderCustomerId || customer?.providerCustomerId || null,
            invoice: projectionInvoice,
            operationKey: toNullableString(projectionMetadata.operation_key),
            billingEventId,
            providerCreatedAt: projectionProviderCreatedAt,
            subscription,
            providerEventId: projectionProviderEventId
          }
        );
      }
    }
  }

  return {
    projectSubscription,
    projectInvoiceAndPayment
  };
}

export { createService };
