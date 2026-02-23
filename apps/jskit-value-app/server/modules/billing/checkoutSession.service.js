import { AppError } from "../../lib/errors.js";
import {
  BILLING_RUNTIME_DEFAULTS,
  BILLING_CHECKOUT_SESSION_STATUS,
  CHECKOUT_BLOCKING_STATUS_SET,
  canTransitionCheckoutStatus,
  isCheckoutTerminalStatus
} from "./constants.js";

function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function pickLaterDate(left, right) {
  const leftDate = toDateOrNull(left);
  const rightDate = toDateOrNull(right);

  if (!leftDate) {
    return rightDate;
  }
  if (!rightDate) {
    return leftDate;
  }

  return leftDate.getTime() >= rightDate.getTime() ? leftDate : rightDate;
}

function isOpenSessionBlocking(session, now, graceSeconds) {
  if (!session || session.status !== BILLING_CHECKOUT_SESSION_STATUS.OPEN) {
    return false;
  }

  const expiresAt = toDateOrNull(session.expiresAt);
  if (!expiresAt) {
    return true;
  }

  return expiresAt.getTime() > now.getTime() - Math.max(0, Number(graceSeconds) || 0) * 1000;
}

function isRecoveryVerificationBlocking(session, now) {
  if (!session || session.status !== BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING) {
    return false;
  }

  const expiresAt = toDateOrNull(session.expiresAt);
  if (!expiresAt) {
    return true;
  }

  return expiresAt.getTime() > now.getTime();
}

function normalizeFlowToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isOneOffCheckoutFlow(session) {
  const metadata = session?.metadataJson && typeof session.metadataJson === "object" ? session.metadataJson : {};
  const flow = normalizeFlowToken(
    metadata.checkoutFlow || metadata.checkout_flow || metadata.checkoutType || metadata.checkout_type
  );
  return flow === "one_off";
}

function mergeMetadataJson(existingMetadata, incomingMetadata) {
  const existing = existingMetadata && typeof existingMetadata === "object" ? existingMetadata : {};
  const incoming = incomingMetadata && typeof incomingMetadata === "object" ? incomingMetadata : {};
  return {
    ...existing,
    ...incoming
  };
}

function createService({
  billingRepository,
  checkoutSessionGraceSeconds = BILLING_RUNTIME_DEFAULTS.CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS
}) {
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (typeof billingRepository.upsertCheckoutSessionByOperationKey !== "function") {
    throw new Error("billingRepository.upsertCheckoutSessionByOperationKey is required.");
  }
  if (typeof billingRepository.findCheckoutSessionByProviderOperationKey !== "function") {
    throw new Error("billingRepository.findCheckoutSessionByProviderOperationKey is required.");
  }

  const graceSeconds = Math.max(0, Number(checkoutSessionGraceSeconds) || 0);

  async function cleanupExpiredBlockingSessions({ billableEntityId, now = new Date(), trx = null }) {
    const sessions = await billingRepository.lockCheckoutSessionsForEntity(billableEntityId, {
      trx,
      forUpdate: true
    });

    const updates = [];
    for (const session of sessions) {
      if (session.status === BILLING_CHECKOUT_SESSION_STATUS.OPEN) {
        const expiresAt = toDateOrNull(session.expiresAt);
        if (expiresAt && expiresAt.getTime() <= now.getTime() - graceSeconds * 1000) {
          const updated = await billingRepository.updateCheckoutSessionById(
            session.id,
            {
              status: BILLING_CHECKOUT_SESSION_STATUS.EXPIRED
            },
            { trx }
          );
          updates.push(updated);
        }
      }

      if (session.status === BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING) {
        const expiresAt = toDateOrNull(session.expiresAt);
        if (expiresAt && expiresAt.getTime() <= now.getTime()) {
          const updated = await billingRepository.updateCheckoutSessionById(
            session.id,
            {
              status: BILLING_CHECKOUT_SESSION_STATUS.ABANDONED
            },
            { trx }
          );
          updates.push(updated);
        }
      }
    }

    return {
      updates,
      sessions
    };
  }

  async function getBlockingCheckoutSession({ billableEntityId, now = new Date(), trx = null, cleanupExpired = false }) {
    const sessions = cleanupExpired
      ? (await cleanupExpiredBlockingSessions({ billableEntityId, now, trx })).sessions
      : await billingRepository.listCheckoutSessionsForEntity(billableEntityId, { trx });

    for (const session of sessions) {
      if (isOneOffCheckoutFlow(session)) {
        continue;
      }

      if (session.status === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION) {
        return session;
      }

      if (isOpenSessionBlocking(session, now, graceSeconds)) {
        return session;
      }

      if (isRecoveryVerificationBlocking(session, now)) {
        return session;
      }
    }

    return null;
  }

  async function assertTransitionAllowed(session, nextStatus) {
    if (!session) {
      throw new AppError(404, "Checkout session not found.");
    }

    if (session.status === nextStatus) {
      return;
    }

    if (!canTransitionCheckoutStatus(session.status, nextStatus)) {
      throw new AppError(409, "Checkout session transition is not allowed.", {
        code: "CHECKOUT_SESSION_TRANSITION_INVALID"
      });
    }
  }

  async function upsertBlockingCheckoutSession(payload, options = {}) {
    const nextStatus = String(payload.status || "").trim();
    if (!CHECKOUT_BLOCKING_STATUS_SET.has(nextStatus)) {
      throw new AppError(500, "Blocking checkout session upsert requires a blocking status.");
    }

    const existing = await billingRepository.findCheckoutSessionByProviderOperationKey(
      {
        provider: payload.provider,
        operationKey: payload.operationKey
      },
      {
        ...options,
        forUpdate: true
      }
    );

    if (existing) {
      if (isCheckoutTerminalStatus(existing.status)) {
        // Preserve terminal states; never regress lifecycle back to blocking.
        return existing;
      }

      await assertTransitionAllowed(existing, nextStatus);
    }

    return billingRepository.upsertCheckoutSessionByOperationKey(payload, options);
  }

  async function markCheckoutSessionCompletedPendingSubscription({
    providerCheckoutSessionId,
    operationKey,
    providerSubscriptionId,
    providerCustomerId,
    providerEventCreatedAt,
    providerEventId,
    billableEntityId,
    provider,
    trx = null
  }) {
    const existing = providerCheckoutSessionId
      ? await billingRepository.findCheckoutSessionByProviderSessionId(
          {
            provider,
            providerCheckoutSessionId
          },
          {
            trx,
            forUpdate: true
          }
        )
      : await billingRepository.findCheckoutSessionByProviderOperationKey(
          {
            provider,
            operationKey
          },
          {
            trx,
            forUpdate: true
          }
        );

    if (existing) {
      if (isCheckoutTerminalStatus(existing.status)) {
        return existing;
      }

      await assertTransitionAllowed(existing, BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION);

      return billingRepository.updateCheckoutSessionById(
        existing.id,
        {
          providerCheckoutSessionId: providerCheckoutSessionId || existing.providerCheckoutSessionId,
          providerCustomerId: providerCustomerId || existing.providerCustomerId,
          providerSubscriptionId: providerSubscriptionId || existing.providerSubscriptionId,
          status: BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION,
          completedAt: providerEventCreatedAt || existing.completedAt,
          lastProviderEventCreatedAt: providerEventCreatedAt || existing.lastProviderEventCreatedAt,
          lastProviderEventId: providerEventId || existing.lastProviderEventId
        },
        { trx }
      );
    }

    return billingRepository.upsertCheckoutSessionByOperationKey(
      {
        billableEntityId,
        provider,
        providerCheckoutSessionId: providerCheckoutSessionId || null,
        operationKey,
        providerCustomerId: providerCustomerId || null,
        providerSubscriptionId: providerSubscriptionId || null,
        status: BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION,
        completedAt: providerEventCreatedAt || null,
        lastProviderEventCreatedAt: providerEventCreatedAt || null,
        lastProviderEventId: providerEventId || null
      },
      { trx }
    );
  }

  async function markCheckoutSessionReconciled({
    providerCheckoutSessionId,
    operationKey,
    providerSubscriptionId,
    providerEventCreatedAt,
    providerEventId,
    provider,
    trx = null
  }) {
    let existing = null;

    if (providerCheckoutSessionId) {
      existing = await billingRepository.findCheckoutSessionByProviderSessionId(
        {
          provider,
          providerCheckoutSessionId
        },
        {
          trx,
          forUpdate: true
        }
      );
    }

    if (!existing && operationKey) {
      existing = await billingRepository.findCheckoutSessionByProviderOperationKey(
        {
          provider,
          operationKey
        },
        {
          trx,
          forUpdate: true
        }
      );
    }

    if (!existing && providerSubscriptionId && typeof billingRepository.findCheckoutSessionByProviderSubscriptionId === "function") {
      existing = await billingRepository.findCheckoutSessionByProviderSubscriptionId(
        {
          provider,
          providerSubscriptionId
        },
        {
          trx,
          forUpdate: true
        }
      );
    }

    if (!existing) {
      return null;
    }

    if (existing.status === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_RECONCILED) {
      return existing;
    }

    if (isCheckoutTerminalStatus(existing.status)) {
      return existing;
    }

    if (existing.status === BILLING_CHECKOUT_SESSION_STATUS.OPEN) {
      existing = await markCheckoutSessionCompletedPendingSubscription({
        providerCheckoutSessionId: providerCheckoutSessionId || existing.providerCheckoutSessionId,
        operationKey: operationKey || existing.operationKey,
        providerCustomerId: existing.providerCustomerId,
        providerSubscriptionId: providerSubscriptionId || existing.providerSubscriptionId,
        providerEventCreatedAt,
        providerEventId,
        billableEntityId: existing.billableEntityId,
        provider,
        trx
      });
    }

    await assertTransitionAllowed(existing, BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_RECONCILED);

    return billingRepository.updateCheckoutSessionById(
      existing.id,
      {
        providerSubscriptionId: providerSubscriptionId || existing.providerSubscriptionId,
        status: BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_RECONCILED,
        lastProviderEventCreatedAt: providerEventCreatedAt || existing.lastProviderEventCreatedAt,
        lastProviderEventId: providerEventId || existing.lastProviderEventId
      },
      { trx }
    );
  }

  async function markCheckoutSessionRecoveryVerificationPending({
    operationKey,
    idempotencyRowId,
    holdExpiresAt,
    providerEventCreatedAt,
    providerEventId,
    billableEntityId,
    metadataJson = null,
    provider,
    trx = null
  }) {
    const existing = await billingRepository.findCheckoutSessionByProviderOperationKey(
      {
        provider,
        operationKey
      },
      {
        trx,
        forUpdate: true
      }
    );

    if (existing) {
      if (existing.status === BILLING_CHECKOUT_SESSION_STATUS.OPEN) {
        return existing;
      }

      if (existing.status === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION) {
        return existing;
      }

      if (isCheckoutTerminalStatus(existing.status)) {
        return existing;
      }

      if (existing.status === BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING) {
        const mergedHoldExpiresAt = pickLaterDate(existing.expiresAt, holdExpiresAt);
        return billingRepository.updateCheckoutSessionById(
          existing.id,
          {
            expiresAt: mergedHoldExpiresAt,
            metadataJson: mergeMetadataJson(existing.metadataJson, metadataJson),
            lastProviderEventCreatedAt: providerEventCreatedAt || existing.lastProviderEventCreatedAt,
            lastProviderEventId: providerEventId || existing.lastProviderEventId
          },
          { trx }
        );
      }

      await assertTransitionAllowed(existing, BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING);
      return billingRepository.updateCheckoutSessionById(
        existing.id,
        {
          idempotencyRowId: idempotencyRowId || existing.idempotencyRowId,
          status: BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING,
          expiresAt: holdExpiresAt,
          metadataJson: mergeMetadataJson(existing.metadataJson, metadataJson),
          lastProviderEventCreatedAt: providerEventCreatedAt || existing.lastProviderEventCreatedAt,
          lastProviderEventId: providerEventId || existing.lastProviderEventId
        },
        { trx }
      );
    }

    return billingRepository.upsertCheckoutSessionByOperationKey(
      {
        billableEntityId,
        provider,
        providerCheckoutSessionId: null,
        idempotencyRowId,
        operationKey,
        status: BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING,
        expiresAt: toDateOrNull(holdExpiresAt),
        metadataJson: mergeMetadataJson(null, metadataJson),
        lastProviderEventCreatedAt: providerEventCreatedAt || null,
        lastProviderEventId: providerEventId || null
      },
      { trx }
    );
  }

  async function markCheckoutSessionExpiredOrAbandoned({
    providerCheckoutSessionId,
    operationKey,
    reason,
    providerEventCreatedAt,
    providerEventId,
    provider,
    trx = null
  }) {
    let existing = null;

    if (providerCheckoutSessionId) {
      existing = await billingRepository.findCheckoutSessionByProviderSessionId(
        {
          provider,
          providerCheckoutSessionId
        },
        {
          trx,
          forUpdate: true
        }
      );
    }

    if (!existing && operationKey) {
      existing = await billingRepository.findCheckoutSessionByProviderOperationKey(
        {
          provider,
          operationKey
        },
        {
          trx,
          forUpdate: true
        }
      );
    }

    if (!existing) {
      return null;
    }

    if (isCheckoutTerminalStatus(existing.status)) {
      return existing;
    }

    const requestedStatus = String(reason || "").trim().toLowerCase() === "abandoned"
      ? BILLING_CHECKOUT_SESSION_STATUS.ABANDONED
      : BILLING_CHECKOUT_SESSION_STATUS.EXPIRED;

    // completed_pending_subscription cannot transition to expired; treat as abandoned cleanup.
    const nextStatus =
      existing.status === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION &&
      requestedStatus === BILLING_CHECKOUT_SESSION_STATUS.EXPIRED
        ? BILLING_CHECKOUT_SESSION_STATUS.ABANDONED
        : requestedStatus;

    await assertTransitionAllowed(existing, nextStatus);

    return billingRepository.updateCheckoutSessionById(
      existing.id,
      {
        providerCheckoutSessionId: providerCheckoutSessionId || existing.providerCheckoutSessionId,
        status: nextStatus,
        lastProviderEventCreatedAt: providerEventCreatedAt || existing.lastProviderEventCreatedAt,
        lastProviderEventId: providerEventId || existing.lastProviderEventId
      },
      { trx }
    );
  }

  async function assertCheckoutSessionCorrelation({ providerCheckoutSessionId, operationKey, billableEntityId, providerCustomerId, provider, trx = null }) {
    const existing = await billingRepository.findCheckoutSessionByProviderSessionId(
      {
        provider,
        providerCheckoutSessionId
      },
      {
        trx,
        forUpdate: true
      }
    );

    if (!existing) {
      throw new AppError(404, "Checkout session correlation target not found.");
    }

    if (operationKey && String(existing.operationKey || "") !== String(operationKey)) {
      throw new AppError(409, "Checkout session operation correlation mismatch.", {
        code: "CHECKOUT_SESSION_CORRELATION_MISMATCH"
      });
    }

    if (billableEntityId != null && Number(existing.billableEntityId) !== Number(billableEntityId)) {
      throw new AppError(409, "Checkout session entity correlation mismatch.", {
        code: "CHECKOUT_SESSION_CORRELATION_MISMATCH"
      });
    }

    if (providerCustomerId && existing.providerCustomerId && String(existing.providerCustomerId) !== String(providerCustomerId)) {
      throw new AppError(409, "Checkout session customer correlation mismatch.", {
        code: "CHECKOUT_SESSION_CORRELATION_MISMATCH"
      });
    }

    return existing;
  }

  return {
    cleanupExpiredBlockingSessions,
    getBlockingCheckoutSession,
    upsertBlockingCheckoutSession,
    markCheckoutSessionCompletedPendingSubscription,
    markCheckoutSessionReconciled,
    markCheckoutSessionRecoveryVerificationPending,
    markCheckoutSessionExpiredOrAbandoned,
    assertCheckoutSessionCorrelation
  };
}

const __testables = {
  toDateOrNull,
  isOpenSessionBlocking,
  isRecoveryVerificationBlocking
};

export { createService, __testables };
