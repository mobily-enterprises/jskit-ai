import { AppError } from "../../lib/errors.js";
import {
  BILLING_ACTIONS,
  BILLING_CHECKOUT_SESSION_STATUS,
  BILLING_FAILURE_CODES,
  BILLING_IDEMPOTENCY_STATUS,
  BILLING_PROVIDER_STRIPE
} from "./constants.js";
import {
  CHECKOUT_CORRELATION_ERROR_CODE,
  buildCheckoutCorrelationError,
  buildCheckoutResponseJson,
  hasSameTimestampOrderingConflict,
  isIncomingEventOlder,
  parseUnixEpochSeconds,
  toNullableString,
  toPositiveInteger,
  toSafeMetadata
} from "./webhookProjection.utils.js";

function createService({
  billingRepository,
  billingCheckoutSessionService,
  stripeSdkService,
  observabilityService = null
}) {
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (!billingCheckoutSessionService) {
    throw new Error("billingCheckoutSessionService is required.");
  }
  if (!stripeSdkService || typeof stripeSdkService.retrieveCheckoutSession !== "function") {
    throw new Error("stripeSdkService.retrieveCheckoutSession is required.");
  }

  function recordCorrelationMismatch(context = {}) {
    const payload = {
      code: "BILLING_CHECKOUT_CORRELATION_MISMATCH",
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
      code: "BILLING_CHECKOUT_CORRELATION_MISMATCH"
    });
  }

  function normalizeCheckoutFlow(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function isOneOffCheckoutFlow(session) {
    const metadata = toSafeMetadata(session?.metadata);
    const metadataFlow = normalizeCheckoutFlow(
      metadata.checkout_flow || metadata.checkout_type || metadata.checkoutFlow || metadata.checkoutType
    );
    if (metadataFlow === "one_off") {
      return true;
    }

    const mode = normalizeCheckoutFlow(session?.mode);
    return mode === "payment";
  }

  function buildOneOffFlowMetadata(metadata = {}) {
    return {
      ...toSafeMetadata(metadata),
      checkout_flow: "one_off",
      checkout_type: "one_off"
    };
  }

  async function fetchAuthoritativeCheckoutSession(providerCheckoutSessionId) {
    const sessionId = toNullableString(providerCheckoutSessionId);
    if (!sessionId) {
      return null;
    }

    try {
      return await stripeSdkService.retrieveCheckoutSession({
        sessionId,
        expand: ["subscription", "customer"]
      });
    } catch {
      return null;
    }
  }

  async function resolveBillableEntityIdFromCustomerId(customerId, trx) {
    const normalizedCustomerId = toNullableString(customerId);
    if (!normalizedCustomerId) {
      return null;
    }

    const customer = await billingRepository.findCustomerByProviderCustomerId(
      {
        provider: BILLING_PROVIDER_STRIPE,
        providerCustomerId: normalizedCustomerId
      },
      { trx }
    );

    if (!customer) {
      return null;
    }

    return toPositiveInteger(customer.billableEntityId);
  }

  async function resolveBillableEntityIdFromCheckoutSession(session, trx) {
    const metadata = toSafeMetadata(session?.metadata);
    const metadataEntityId = toPositiveInteger(metadata.billable_entity_id);
    if (metadataEntityId) {
      return metadataEntityId;
    }

    return resolveBillableEntityIdFromCustomerId(session?.customer, trx);
  }

  async function lockEntityAggregate({ billableEntityId, operationKey, trx }) {
    await billingRepository.findBillableEntityById(billableEntityId, {
      trx,
      forUpdate: true
    });
    await billingRepository.lockSubscriptionsForEntity(billableEntityId, {
      trx,
      forUpdate: true
    });

    let idempotencyRow = null;
    if (operationKey && typeof billingRepository.findCheckoutIdempotencyByOperationKey === "function") {
      idempotencyRow = await billingRepository.findCheckoutIdempotencyByOperationKey(operationKey, {
        trx,
        forUpdate: true
      });
    }

    await billingRepository.lockCheckoutSessionsForEntity(billableEntityId, {
      trx,
      forUpdate: true
    });

    return { idempotencyRow };
  }

  function assertCheckoutCorrelation({
    existing,
    providerCheckoutSessionId,
    operationKey,
    billableEntityId,
    providerCustomerId
  }) {
    if (!existing) {
      return;
    }

    if (operationKey && String(existing.operationKey || "") !== String(operationKey)) {
      throw buildCheckoutCorrelationError("Checkout session operation correlation mismatch.");
    }

    if (
      providerCheckoutSessionId &&
      existing.providerCheckoutSessionId &&
      String(existing.providerCheckoutSessionId) !== String(providerCheckoutSessionId)
    ) {
      throw buildCheckoutCorrelationError("Checkout session id correlation mismatch.");
    }

    if (billableEntityId != null && Number(existing.billableEntityId) !== Number(billableEntityId)) {
      throw buildCheckoutCorrelationError("Checkout session entity correlation mismatch.");
    }

    if (
      providerCustomerId &&
      existing.providerCustomerId &&
      String(existing.providerCustomerId) !== String(providerCustomerId)
    ) {
      throw buildCheckoutCorrelationError("Checkout session customer correlation mismatch.");
    }
  }

  async function enforceCheckoutCorrelation({
    providerCheckoutSessionId,
    operationKey,
    billableEntityId,
    providerCustomerId,
    trx
  }) {
    let existingBySession = null;
    if (providerCheckoutSessionId) {
      existingBySession = await billingRepository.findCheckoutSessionByProviderSessionId(
        {
          provider: BILLING_PROVIDER_STRIPE,
          providerCheckoutSessionId
        },
        {
          trx,
          forUpdate: true
        }
      );
    }

    if (existingBySession) {
      assertCheckoutCorrelation({
        existing: existingBySession,
        providerCheckoutSessionId,
        operationKey,
        billableEntityId,
        providerCustomerId
      });
      return existingBySession;
    }

    if (!operationKey) {
      return null;
    }

    const existingByOperationKey = await billingRepository.findCheckoutSessionByProviderOperationKey(
      {
        provider: BILLING_PROVIDER_STRIPE,
        operationKey
      },
      {
        trx,
        forUpdate: true
      }
    );

    if (existingByOperationKey) {
      assertCheckoutCorrelation({
        existing: existingByOperationKey,
        providerCheckoutSessionId,
        operationKey,
        billableEntityId,
        providerCustomerId
      });
    }

    return existingByOperationKey;
  }

  async function maybeFinalizePendingCheckoutIdempotency({
    idempotencyRow,
    session,
    billableEntityId,
    operationKey,
    trx
  }) {
    if (!idempotencyRow) {
      return;
    }

    if (
      idempotencyRow.action !== BILLING_ACTIONS.CHECKOUT ||
      idempotencyRow.status !== BILLING_IDEMPOTENCY_STATUS.PENDING
    ) {
      return;
    }

    await billingRepository.updateIdempotencyById(
      idempotencyRow.id,
      {
        status: BILLING_IDEMPOTENCY_STATUS.SUCCEEDED,
        responseJson: buildCheckoutResponseJson({
          session,
          billableEntityId,
          operationKey
        }),
        providerSessionId: toNullableString(session?.id),
        pendingLeaseExpiresAt: null,
        pendingLastHeartbeatAt: null,
        leaseOwner: null,
        failureCode: null,
        failureReason: null
      },
      { trx }
    );
  }

  async function maybeExpirePendingCheckoutIdempotency({ idempotencyRow, reason, trx }) {
    if (!idempotencyRow) {
      return;
    }

    if (
      idempotencyRow.action !== BILLING_ACTIONS.CHECKOUT ||
      idempotencyRow.status !== BILLING_IDEMPOTENCY_STATUS.PENDING
    ) {
      return;
    }

    await billingRepository.updateIdempotencyById(
      idempotencyRow.id,
      {
        status: BILLING_IDEMPOTENCY_STATUS.EXPIRED,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED,
        failureReason: String(reason || "Checkout session expired before completion."),
        pendingLeaseExpiresAt: null,
        pendingLastHeartbeatAt: null,
        leaseOwner: null
      },
      { trx }
    );
  }

  async function handleCheckoutSessionCompleted(session, eventContext) {
    const { trx, providerCreatedAt, providerEventId } = eventContext;

    const metadata = toSafeMetadata(session?.metadata);
    const operationKey = toNullableString(metadata.operation_key);
    const billableEntityId = await resolveBillableEntityIdFromCheckoutSession(session, trx);
    const providerCheckoutSessionId = toNullableString(session?.id);
    const providerCustomerId = toNullableString(session?.customer);

    if (!operationKey || !billableEntityId || !providerCheckoutSessionId) {
      recordCorrelationMismatch({
        operationKey,
        providerEventId,
        billableEntityId
      });
      throw buildCheckoutCorrelationError("Checkout session correlation metadata is invalid.");
    }

    const { idempotencyRow } = await lockEntityAggregate({
      billableEntityId,
      operationKey,
      trx
    });

    let correlatedSession = null;
    try {
      correlatedSession = await enforceCheckoutCorrelation({
        providerCheckoutSessionId,
        operationKey,
        billableEntityId,
        providerCustomerId,
        trx
      });
    } catch (error) {
      if (String(error?.code || "").trim() === CHECKOUT_CORRELATION_ERROR_CODE) {
        recordCorrelationMismatch({
          operationKey,
          providerEventId,
          billableEntityId
        });
      }
      throw error;
    }

    let projectionSession = session;
    let projectionProviderCreatedAt = providerCreatedAt;
    let projectionProviderEventId = providerEventId;
    const olderThanExisting = isIncomingEventOlder(correlatedSession?.lastProviderEventCreatedAt, providerCreatedAt, {
      existingProviderEventId: correlatedSession?.lastProviderEventId,
      incomingProviderEventId: providerEventId
    });

    if (olderThanExisting) {
      const sameTimestampConflict = hasSameTimestampOrderingConflict(
        correlatedSession?.lastProviderEventCreatedAt,
        providerCreatedAt,
        {
          existingProviderEventId: correlatedSession?.lastProviderEventId,
          incomingProviderEventId: providerEventId
        }
      );

      if (!sameTimestampConflict) {
        return;
      }

      const authoritativeSession = await fetchAuthoritativeCheckoutSession(providerCheckoutSessionId);
      if (!authoritativeSession) {
        return;
      }

      projectionSession = authoritativeSession;
      const existingProviderCreatedAt = new Date(correlatedSession.lastProviderEventCreatedAt || 0);
      projectionProviderCreatedAt = Number.isNaN(existingProviderCreatedAt.getTime())
        ? providerCreatedAt
        : existingProviderCreatedAt;
      projectionProviderEventId = toNullableString(correlatedSession.lastProviderEventId) || providerEventId;
    }

    const projectionProviderCustomerId = toNullableString(projectionSession?.customer) || providerCustomerId;
    const projectionProviderSubscriptionId = toNullableString(projectionSession?.subscription);
    const projectionMetadata = toSafeMetadata(projectionSession?.metadata);

    if (isOneOffCheckoutFlow(projectionSession)) {
      const reconciled = await billingCheckoutSessionService.markCheckoutSessionReconciled({
        providerCheckoutSessionId,
        operationKey,
        providerSubscriptionId: projectionProviderSubscriptionId,
        providerEventCreatedAt: projectionProviderCreatedAt,
        providerEventId: projectionProviderEventId,
        provider: BILLING_PROVIDER_STRIPE,
        trx
      });

      if (!reconciled) {
        await billingRepository.upsertCheckoutSessionByOperationKey(
          {
            billableEntityId,
            provider: BILLING_PROVIDER_STRIPE,
            providerCheckoutSessionId,
            operationKey,
            providerCustomerId: projectionProviderCustomerId,
            providerSubscriptionId: projectionProviderSubscriptionId,
            status: BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_RECONCILED,
            checkoutUrl: toNullableString(projectionSession?.url),
            expiresAt: parseUnixEpochSeconds(projectionSession?.expires_at),
            completedAt: projectionProviderCreatedAt,
            lastProviderEventCreatedAt: projectionProviderCreatedAt,
            lastProviderEventId: projectionProviderEventId,
            metadataJson: buildOneOffFlowMetadata(projectionMetadata)
          },
          { trx }
        );
      }
    } else {
      await billingCheckoutSessionService.markCheckoutSessionCompletedPendingSubscription({
        providerCheckoutSessionId,
        operationKey,
        providerCustomerId: projectionProviderCustomerId,
        providerSubscriptionId: projectionProviderSubscriptionId,
        providerEventCreatedAt: projectionProviderCreatedAt,
        providerEventId: projectionProviderEventId,
        billableEntityId,
        provider: BILLING_PROVIDER_STRIPE,
        trx
      });
    }

    await maybeFinalizePendingCheckoutIdempotency({
      idempotencyRow,
      session: projectionSession,
      billableEntityId,
      operationKey,
      trx
    });
  }

  async function handleCheckoutSessionExpired(session, eventContext) {
    const { trx, providerCreatedAt, providerEventId } = eventContext;

    const providerCheckoutSessionId = toNullableString(session?.id);
    if (!providerCheckoutSessionId) {
      throw new AppError(400, "Stripe checkout session payload missing id.");
    }

    const metadata = toSafeMetadata(session?.metadata);
    const operationKeyFromMetadata = toNullableString(metadata.operation_key);
    const providerCustomerId = toNullableString(session?.customer);

    let existingSession = await billingRepository.findCheckoutSessionByProviderSessionId(
      {
        provider: BILLING_PROVIDER_STRIPE,
        providerCheckoutSessionId
      },
      {
        trx,
        forUpdate: true
      }
    );

    const operationKey =
      operationKeyFromMetadata ||
      (existingSession ? toNullableString(existingSession.operationKey) : null);

    let billableEntityId = await resolveBillableEntityIdFromCheckoutSession(session, trx);
    if (!billableEntityId && existingSession) {
      billableEntityId = toPositiveInteger(existingSession.billableEntityId);
    }

    if (!billableEntityId) {
      recordCorrelationMismatch({
        operationKey: operationKeyFromMetadata,
        providerEventId
      });
      throw buildCheckoutCorrelationError("Unable to correlate checkout.session.expired to billable entity.");
    }

    const { idempotencyRow } = await lockEntityAggregate({
      billableEntityId,
      operationKey,
      trx
    });

    existingSession = await enforceCheckoutCorrelation({
      providerCheckoutSessionId,
      operationKey,
      billableEntityId,
      providerCustomerId,
      trx
    });

    let projectionSession = session;
    let projectionProviderCreatedAt = providerCreatedAt;
    let projectionProviderEventId = providerEventId;
    const olderThanExisting = isIncomingEventOlder(existingSession?.lastProviderEventCreatedAt, providerCreatedAt, {
      existingProviderEventId: existingSession?.lastProviderEventId,
      incomingProviderEventId: providerEventId
    });

    if (olderThanExisting) {
      const sameTimestampConflict = hasSameTimestampOrderingConflict(
        existingSession?.lastProviderEventCreatedAt,
        providerCreatedAt,
        {
          existingProviderEventId: existingSession?.lastProviderEventId,
          incomingProviderEventId: providerEventId
        }
      );

      if (!sameTimestampConflict) {
        return;
      }

      const authoritativeSession = await fetchAuthoritativeCheckoutSession(providerCheckoutSessionId);
      if (!authoritativeSession) {
        return;
      }

      projectionSession = authoritativeSession;
      const existingProviderCreatedAt = new Date(existingSession.lastProviderEventCreatedAt || 0);
      projectionProviderCreatedAt = Number.isNaN(existingProviderCreatedAt.getTime())
        ? providerCreatedAt
        : existingProviderCreatedAt;
      projectionProviderEventId = toNullableString(existingSession.lastProviderEventId) || providerEventId;
    }

    const projectionMetadata = toSafeMetadata(projectionSession?.metadata);
    const projectionProviderCustomerId = toNullableString(projectionSession?.customer) || providerCustomerId;

    if (existingSession) {
      await billingCheckoutSessionService.markCheckoutSessionExpiredOrAbandoned({
        providerCheckoutSessionId,
        operationKey,
        reason: "expired",
        providerEventCreatedAt: projectionProviderCreatedAt,
        providerEventId: projectionProviderEventId,
        provider: BILLING_PROVIDER_STRIPE,
        trx
      });
    } else if (operationKey) {
      await billingRepository.upsertCheckoutSessionByOperationKey(
        {
          billableEntityId,
          provider: BILLING_PROVIDER_STRIPE,
          providerCheckoutSessionId,
          operationKey,
          providerCustomerId: projectionProviderCustomerId,
          providerSubscriptionId: toNullableString(projectionSession?.subscription),
          status: BILLING_CHECKOUT_SESSION_STATUS.EXPIRED,
          checkoutUrl: toNullableString(projectionSession?.url),
          expiresAt: parseUnixEpochSeconds(projectionSession?.expires_at),
          lastProviderEventCreatedAt: projectionProviderCreatedAt,
          lastProviderEventId: projectionProviderEventId,
          metadataJson: projectionMetadata
        },
        { trx }
      );
    } else {
      recordCorrelationMismatch({
        operationKey,
        providerEventId,
        billableEntityId
      });
      throw buildCheckoutCorrelationError("checkout.session.expired payload is missing operation_key metadata.");
    }

    await maybeExpirePendingCheckoutIdempotency({
      idempotencyRow,
      reason: "Checkout session expired before subscription projection completed.",
      trx
    });
  }

  return {
    resolveBillableEntityIdFromCustomerId,
    lockEntityAggregate,
    maybeFinalizePendingCheckoutIdempotency,
    handleCheckoutSessionCompleted,
    handleCheckoutSessionExpired
  };
}

export { createService };
