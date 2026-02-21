/* eslint-disable max-lines */
import { AppError } from "../../lib/errors.js";
import {
  BILLING_ACTIONS,
  BILLING_CHECKOUT_SESSION_STATUS,
  BILLING_DEFAULT_PROVIDER,
  BILLING_FAILURE_CODES,
  BILLING_IDEMPOTENCY_STATUS,
  BILLING_RUNTIME_DEFAULTS,
  NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET,
} from "./constants.js";
import { createService as createWebhookProjectionService } from "./webhookProjection.service.js";
import { normalizeProviderSubscriptionStatus, toNullableString, toSafeMetadata } from "./webhookProjection.utils.js";

function providerSessionStatusToLocalStatus(providerStatus) {
  const normalized = String(providerStatus || "").trim().toLowerCase();
  if (normalized === "complete") {
    return BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION;
  }

  if (normalized === "expired") {
    return BILLING_CHECKOUT_SESSION_STATUS.EXPIRED;
  }

  return BILLING_CHECKOUT_SESSION_STATUS.OPEN;
}

function parseDateOrNull(value) {
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
  const leftDate = parseDateOrNull(left);
  const rightDate = parseDateOrNull(right);

  if (!leftDate) {
    return rightDate;
  }
  if (!rightDate) {
    return leftDate;
  }

  return leftDate.getTime() >= rightDate.getTime() ? leftDate : rightDate;
}

function parseUnixEpochSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return new Date(parsed * 1000);
}

function hasCurrentStatus(status) {
  return NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET.has(String(status || "").trim());
}

function computeAgeSeconds(referenceTime, now) {
  const referenceDate = parseDateOrNull(referenceTime);
  if (!referenceDate) {
    return null;
  }

  const ageMs = Number(now?.getTime?.() || Date.now()) - referenceDate.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return 0;
  }

  return ageMs / 1000;
}

function normalizeProvider(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function createService(options = {}) {
  const {
    billingRepository,
    billingProviderAdapter,
    billingCheckoutSessionService,
    billingWebhookService = null,
    observabilityService = null,
    checkoutSessionGraceSeconds = BILLING_RUNTIME_DEFAULTS.CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS,
    completionSlaSeconds = 5 * 60,
    stalePendingLeaseSeconds = BILLING_RUNTIME_DEFAULTS.CHECKOUT_PENDING_LEASE_SECONDS * 2
  } = options;
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (typeof billingRepository.acquireReconciliationRun !== "function") {
    throw new Error("billingRepository.acquireReconciliationRun is required.");
  }
  if (typeof billingRepository.transaction !== "function") {
    throw new Error("billingRepository.transaction is required.");
  }
  const providerAdapter = billingProviderAdapter;
  if (!providerAdapter) {
    throw new Error("billingProviderAdapter is required.");
  }
  const activeProvider = normalizeProvider(providerAdapter?.provider || BILLING_DEFAULT_PROVIDER) || BILLING_DEFAULT_PROVIDER;
  if (!billingCheckoutSessionService) {
    throw new Error("billingCheckoutSessionService is required.");
  }

  const graceSeconds = Math.max(0, Number(checkoutSessionGraceSeconds) || 0);
  const completionGraceSeconds = Math.max(1, Number(completionSlaSeconds) || 1);
  const staleLeaseWindowSeconds = Math.max(1, Number(stalePendingLeaseSeconds) || 1);
  const webhookProjectionService = createWebhookProjectionService({
    billingRepository,
    billingCheckoutSessionService,
    billingProviderAdapter: providerAdapter,
    observabilityService
  });

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

  async function lockEntityAggregate({ billableEntityId, idempotencyRowId = null, trx }) {
    await billingRepository.findBillableEntityById(billableEntityId, {
      trx,
      forUpdate: true
    });
    await billingRepository.lockSubscriptionsForEntity(billableEntityId, {
      trx,
      forUpdate: true
    });
    if (idempotencyRowId != null) {
      await billingRepository.findIdempotencyById(idempotencyRowId, {
        trx,
        forUpdate: true
      });
    }

    const checkoutSessions = await billingRepository.lockCheckoutSessionsForEntity(billableEntityId, {
      trx,
      forUpdate: true
    });

    return {
      checkoutSessions
    };
  }

  function findLockedCheckoutSessionById(checkoutSessions, sessionId) {
    return (Array.isArray(checkoutSessions) ? checkoutSessions : []).find((row) => Number(row.id) === Number(sessionId)) || null;
  }

  async function resolveProviderCheckoutSession(session) {
    if (session?.providerCheckoutSessionId) {
      try {
        return await providerAdapter.retrieveCheckoutSession({
          sessionId: session.providerCheckoutSessionId,
          expand: ["subscription", "customer"]
        });
      } catch {
        return null;
      }
    }

    if (!session?.operationKey || typeof providerAdapter.listCheckoutSessionsByOperationKey !== "function") {
      return null;
    }

    try {
      const candidates = await providerAdapter.listCheckoutSessionsByOperationKey({
        operationKey: session.operationKey,
        limit: 10
      });
      return Array.isArray(candidates) ? candidates[0] || null : null;
    } catch {
      return null;
    }
  }

  async function reconcileOpenCheckoutSessions(now) {
    const sessions = await billingRepository.listReconciliationCheckoutSessions({
      status: BILLING_CHECKOUT_SESSION_STATUS.OPEN,
      olderThan: new Date(now.getTime() - graceSeconds * 1000),
      olderThanColumn: "expires_at",
      includeNullOlderThan: true,
      limit: 200
    });

    let repairedCount = 0;

    for (const session of sessions) {
      const providerSession = await resolveProviderCheckoutSession(session);
      if (!providerSession) {
        continue;
      }

      const localStatus = providerSessionStatusToLocalStatus(providerSession.status);
      if (
        localStatus !== BILLING_CHECKOUT_SESSION_STATUS.EXPIRED &&
        localStatus !== BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION
      ) {
        continue;
      }

      const repaired = await billingRepository.transaction(async (trx) => {
        const { checkoutSessions } = await lockEntityAggregate({
          billableEntityId: session.billableEntityId,
          idempotencyRowId: session.idempotencyRowId,
          trx
        });
        const lockedSession = findLockedCheckoutSessionById(checkoutSessions, session.id);
        if (!lockedSession || lockedSession.status !== BILLING_CHECKOUT_SESSION_STATUS.OPEN) {
          return false;
        }

        if (localStatus === BILLING_CHECKOUT_SESSION_STATUS.EXPIRED) {
          await billingCheckoutSessionService.markCheckoutSessionExpiredOrAbandoned({
            providerCheckoutSessionId: toNullableString(providerSession.id) || lockedSession.providerCheckoutSessionId,
            operationKey: lockedSession.operationKey,
            reason: "expired",
            providerEventCreatedAt: now,
            provider: activeProvider,
            trx
          });
          return true;
        }

        await billingCheckoutSessionService.markCheckoutSessionCompletedPendingSubscription({
          providerCheckoutSessionId: toNullableString(providerSession.id) || lockedSession.providerCheckoutSessionId,
          operationKey: lockedSession.operationKey,
          providerCustomerId: toNullableString(providerSession.customer) || lockedSession.providerCustomerId,
          providerSubscriptionId: toNullableString(providerSession.subscription),
          providerEventCreatedAt: now,
          billableEntityId: lockedSession.billableEntityId,
          provider: activeProvider,
          trx
        });
        return true;
      });

      if (repaired) {
        repairedCount += 1;
      }
    }

    recordGuardrail("BILLING_BLOCKING_CHECKOUT_SESSIONS_OLDER_THAN_SLA", {
      measure: "count",
      value: sessions.length
    });

    return {
      scannedCount: sessions.length,
      repairedCount,
      driftCount: repairedCount
    };
  }

  async function reconcileCompletedPendingCheckoutSessions(now) {
    const sessions = await billingRepository.listReconciliationCheckoutSessions({
      status: BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION,
      olderThan: new Date(now.getTime() - completionGraceSeconds * 1000),
      olderThanColumn: "completed_at",
      includeNullOlderThan: true,
      limit: 200
    });

    let repairedCount = 0;

    for (const session of sessions) {
      const providerSession = await resolveProviderCheckoutSession(session);
      if (!providerSession) {
        continue;
      }

      const providerSubscriptionId = toNullableString(providerSession.subscription);
      const providerState = providerSessionStatusToLocalStatus(providerSession.status);
      let providerSubscription = null;

      if (providerSubscriptionId) {
        try {
          providerSubscription = await providerAdapter.retrieveSubscription({
            subscriptionId: providerSubscriptionId
          });
        } catch {
          providerSubscription = null;
        }
      }

      const repaired = await billingRepository.transaction(async (trx) => {
        const { checkoutSessions } = await lockEntityAggregate({
          billableEntityId: session.billableEntityId,
          idempotencyRowId: session.idempotencyRowId,
          trx
        });
        const lockedSession = findLockedCheckoutSessionById(checkoutSessions, session.id);
        if (!lockedSession || lockedSession.status !== BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION) {
          return false;
        }

        if (providerSubscriptionId) {
          const localSubscription = await billingRepository.findSubscriptionByProviderSubscriptionId(
            {
              provider: activeProvider,
              providerSubscriptionId
            },
            {
              trx,
              forUpdate: true
            }
          );

          if (localSubscription) {
            await billingCheckoutSessionService.markCheckoutSessionReconciled({
              providerCheckoutSessionId: toNullableString(providerSession.id) || lockedSession.providerCheckoutSessionId,
              operationKey: lockedSession.operationKey,
              providerSubscriptionId,
              providerEventCreatedAt: now,
              provider: activeProvider,
              trx
            });
            return true;
          }

          if (providerSubscription) {
            const providerMetadata = toSafeMetadata(providerSubscription.metadata);
            const projectedSubscription = {
              ...providerSubscription,
              metadata: {
                ...providerMetadata,
                operation_key: providerMetadata.operation_key || lockedSession.operationKey,
                billable_entity_id:
                  providerMetadata.billable_entity_id || String(lockedSession.billableEntityId)
              },
              customer: providerSubscription.customer || lockedSession.providerCustomerId
            };

            await webhookProjectionService.projectSubscription(projectedSubscription, {
              trx,
              providerCreatedAt: now,
              providerEventId: `reconciliation.subscription.${lockedSession.id}.${now.getTime()}`
            });

            const refreshed = await billingRepository.findCheckoutSessionByProviderOperationKey(
              {
                provider: activeProvider,
                operationKey: lockedSession.operationKey
              },
              {
                trx,
                forUpdate: true
              }
            );

            if (
              refreshed &&
              refreshed.status !== BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION
            ) {
              return true;
            }
          }
        }

        if (providerState === BILLING_CHECKOUT_SESSION_STATUS.EXPIRED) {
          await billingCheckoutSessionService.markCheckoutSessionExpiredOrAbandoned({
            providerCheckoutSessionId: toNullableString(providerSession.id) || lockedSession.providerCheckoutSessionId,
            operationKey: lockedSession.operationKey,
            reason: "abandoned",
            providerEventCreatedAt: now,
            provider: activeProvider,
            trx
          });
          return true;
        }

        return false;
      });

      if (repaired) {
        repairedCount += 1;
      }
    }

    recordGuardrail("BILLING_BLOCKING_CHECKOUT_SESSIONS_OLDER_THAN_SLA", {
      measure: "count",
      value: sessions.length
    });

    return {
      scannedCount: sessions.length,
      repairedCount,
      driftCount: repairedCount
    };
  }

  async function reconcileRecoveryVerificationCheckoutSessions(now) {
    const sessions = await billingRepository.listReconciliationCheckoutSessions({
      status: BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING,
      olderThan: null,
      limit: 200
    });

    let repairedCount = 0;
    let maxAgeSeconds = 0;

    for (const session of sessions) {
      const ageSeconds = computeAgeSeconds(session.createdAt || session.updatedAt, now);
      if (ageSeconds != null) {
        maxAgeSeconds = Math.max(maxAgeSeconds, ageSeconds);
      }

      const providerSession = await resolveProviderCheckoutSession(session);
      const repaired = await billingRepository.transaction(async (trx) => {
        const { checkoutSessions } = await lockEntityAggregate({
          billableEntityId: session.billableEntityId,
          idempotencyRowId: session.idempotencyRowId,
          trx
        });
        const lockedSession = findLockedCheckoutSessionById(checkoutSessions, session.id);
        if (!lockedSession || lockedSession.status !== BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING) {
          return false;
        }

        if (providerSession) {
          const localStatus = providerSessionStatusToLocalStatus(providerSession.status);
          if (localStatus === BILLING_CHECKOUT_SESSION_STATUS.OPEN) {
            await billingRepository.updateCheckoutSessionById(
              lockedSession.id,
              {
                status: BILLING_CHECKOUT_SESSION_STATUS.OPEN,
                providerCheckoutSessionId: toNullableString(providerSession.id) || lockedSession.providerCheckoutSessionId,
                checkoutUrl: toNullableString(providerSession.url),
                expiresAt:
                  parseUnixEpochSeconds(providerSession.expires_at) ||
                  parseDateOrNull(lockedSession.expiresAt),
                providerCustomerId: toNullableString(providerSession.customer),
                providerSubscriptionId: toNullableString(providerSession.subscription),
                lastProviderEventCreatedAt: now
              },
              { trx }
            );
            return true;
          }

          if (localStatus === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION) {
            await billingCheckoutSessionService.markCheckoutSessionCompletedPendingSubscription({
              providerCheckoutSessionId: toNullableString(providerSession.id) || lockedSession.providerCheckoutSessionId,
              operationKey: lockedSession.operationKey,
              providerCustomerId: toNullableString(providerSession.customer) || lockedSession.providerCustomerId,
              providerSubscriptionId: toNullableString(providerSession.subscription),
              providerEventCreatedAt: now,
              billableEntityId: lockedSession.billableEntityId,
              provider: activeProvider,
              trx
            });
            return true;
          }

          if (localStatus === BILLING_CHECKOUT_SESSION_STATUS.EXPIRED) {
            await billingCheckoutSessionService.markCheckoutSessionExpiredOrAbandoned({
              providerCheckoutSessionId: toNullableString(providerSession.id) || lockedSession.providerCheckoutSessionId,
              operationKey: lockedSession.operationKey,
              reason: "expired",
              providerEventCreatedAt: now,
              provider: activeProvider,
              trx
            });
            return true;
          }
        }

        const holdExpiresAt = parseDateOrNull(lockedSession.expiresAt);
        if (holdExpiresAt && holdExpiresAt.getTime() <= now.getTime()) {
          await billingRepository.updateCheckoutSessionById(
            lockedSession.id,
            {
              status: BILLING_CHECKOUT_SESSION_STATUS.ABANDONED,
              lastProviderEventCreatedAt: now
            },
            { trx }
          );
          return true;
        }

        return false;
      });

      if (repaired) {
        repairedCount += 1;
      }
    }

    recordGuardrail("BILLING_CHECKOUT_RECOVERY_VERIFICATION_PENDING", {
      measure: "count",
      value: sessions.length
    });
    if (sessions.length > 0) {
      recordGuardrail("BILLING_CHECKOUT_RECOVERY_VERIFICATION_PENDING", {
        measure: "age_seconds",
        value: maxAgeSeconds
      });
    }

    return {
      scannedCount: sessions.length,
      repairedCount,
      driftCount: repairedCount
    };
  }

  async function reconcilePendingRecent(now) {
    const staleBefore = new Date(now.getTime() - staleLeaseWindowSeconds * 1000);
    const pendingRowsRaw = await billingRepository.listPendingIdempotencyRows({
      action: BILLING_ACTIONS.CHECKOUT,
      staleBefore,
      limit: 200
    });
    const failedWebhookEventsRaw = typeof billingRepository.listFailedWebhookEvents === "function"
      ? await billingRepository.listFailedWebhookEvents({
          olderThan: staleBefore,
          limit: 200
        })
      : [];
    const pendingRows = (Array.isArray(pendingRowsRaw) ? pendingRowsRaw : []).filter(
      (row) => normalizeProvider(row?.provider) === activeProvider
    );
    const failedWebhookEvents = (Array.isArray(failedWebhookEventsRaw) ? failedWebhookEventsRaw : []).filter(
      (row) => normalizeProvider(row?.provider) === activeProvider
    );

    let replayDeadlineNearCount = 0;
    let replayDeadlineExceededCount = 0;
    let replayDeadlineExceededMaxAgeSeconds = 0;
    const replayDeadlineNearThresholdSeconds = 15 * 60;
    for (const pendingRow of pendingRows) {
      const replayDeadlineAt = parseDateOrNull(pendingRow.providerIdempotencyReplayDeadlineAt);
      if (!replayDeadlineAt) {
        continue;
      }

      const secondsUntilDeadline = (replayDeadlineAt.getTime() - now.getTime()) / 1000;
      if (secondsUntilDeadline <= 0) {
        replayDeadlineExceededCount += 1;
        replayDeadlineExceededMaxAgeSeconds = Math.max(
          replayDeadlineExceededMaxAgeSeconds,
          Math.abs(secondsUntilDeadline)
        );
      } else if (secondsUntilDeadline <= replayDeadlineNearThresholdSeconds) {
        replayDeadlineNearCount += 1;
      }
    }

    recordGuardrail("BILLING_PENDING_CHECKOUT_IDEMPOTENCY_OLDER_THAN_2X_LEASE_TTL", {
      measure: "count",
      value: pendingRows.length
    });
    recordGuardrail("BILLING_PENDING_CHECKOUT_REPLAY_DEADLINE_NEARING", {
      measure: "count",
      value: replayDeadlineNearCount
    });
    recordGuardrail("BILLING_PENDING_CHECKOUT_REPLAY_DEADLINE_EXCEEDED", {
      measure: "count",
      value: replayDeadlineExceededCount
    });
    if (replayDeadlineExceededCount > 0) {
      recordGuardrail("BILLING_PENDING_CHECKOUT_REPLAY_DEADLINE_EXCEEDED", {
        measure: "age_seconds",
        value: replayDeadlineExceededMaxAgeSeconds
      });
    }

    let repairedCount = 0;

    for (const pendingRow of pendingRows) {
      const repaired = await billingRepository.transaction(async (trx) => {
        const { checkoutSessions } = await lockEntityAggregate({
          billableEntityId: pendingRow.billableEntityId,
          idempotencyRowId: pendingRow.id,
          trx
        });

        const lockedPendingRow = await billingRepository.findIdempotencyById(pendingRow.id, {
          trx,
          forUpdate: true
        });
        if (!lockedPendingRow || lockedPendingRow.status !== BILLING_IDEMPOTENCY_STATUS.PENDING) {
          return false;
        }

        const replayDeadlineAt = parseDateOrNull(lockedPendingRow.providerIdempotencyReplayDeadlineAt);
        if (!replayDeadlineAt) {
          await billingRepository.updateIdempotencyById(
            lockedPendingRow.id,
            {
              status: BILLING_IDEMPOTENCY_STATUS.FAILED,
              failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
              failureReason: "Pending checkout replay deadline is missing during reconciliation.",
              pendingLeaseExpiresAt: null,
              pendingLastHeartbeatAt: null,
              leaseOwner: null
            },
            { trx }
          );
          return true;
        }

        const providerSessionId = toNullableString(lockedPendingRow.providerSessionId);
        if (providerSessionId) {
          return false;
        }

        if (now.getTime() < replayDeadlineAt.getTime()) {
          return false;
        }

        const operationKey = toNullableString(lockedPendingRow.operationKey);
        const sessionUpperBound = parseDateOrNull(lockedPendingRow.providerCheckoutSessionExpiresAtUpperBound);
        if (!operationKey || !sessionUpperBound) {
          await billingRepository.updateIdempotencyById(
            lockedPendingRow.id,
            {
              status: BILLING_IDEMPOTENCY_STATUS.FAILED,
              failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
              failureReason: "Pending checkout recovery metadata is missing during reconciliation.",
              pendingLeaseExpiresAt: null,
              pendingLastHeartbeatAt: null,
              leaseOwner: null
            },
            { trx }
          );
          return true;
        }

        const holdRiskUntil = sessionUpperBound
          ? new Date(sessionUpperBound.getTime() + graceSeconds * 1000)
          : null;

        const correlatedSession = operationKey
          ? checkoutSessions.find(
              (session) =>
                session.provider === activeProvider &&
                String(session.operationKey || "") === String(operationKey)
            ) || null
          : null;

        const shouldMaterializeHold = Boolean(
          holdRiskUntil &&
            now.getTime() < holdRiskUntil.getTime() &&
            (!correlatedSession ||
              correlatedSession.status === BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING)
        );

        if (shouldMaterializeHold && !correlatedSession) {
          await billingRepository.upsertCheckoutSessionByOperationKey(
            {
              billableEntityId: lockedPendingRow.billableEntityId,
              provider: activeProvider,
              providerCheckoutSessionId: null,
              idempotencyRowId: lockedPendingRow.id,
              operationKey,
              status: BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING,
              expiresAt: holdRiskUntil,
              lastProviderEventCreatedAt: now
            },
            { trx }
          );
        } else if (
          shouldMaterializeHold &&
          correlatedSession &&
          correlatedSession.status === BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING
        ) {
          const holdExpiresAt = pickLaterDate(correlatedSession.expiresAt, holdRiskUntil);
          await billingRepository.updateCheckoutSessionById(
            correlatedSession.id,
            {
              expiresAt: holdExpiresAt,
              lastProviderEventCreatedAt: now
            },
            { trx }
          );
        }

        await billingRepository.updateIdempotencyById(
          lockedPendingRow.id,
          {
            status: BILLING_IDEMPOTENCY_STATUS.EXPIRED,
            failureCode: BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED,
            failureReason: "Pending checkout recovery exceeded replay deadline during reconciliation.",
            pendingLeaseExpiresAt: null,
            pendingLastHeartbeatAt: null,
            leaseOwner: null
          },
          { trx }
        );

        return true;
      });

      if (repaired) {
        repairedCount += 1;
      }
    }

    let replayedWebhookCount = 0;
    if (
      billingWebhookService &&
      typeof billingWebhookService.reprocessStoredEvent === "function" &&
      failedWebhookEvents.length > 0
    ) {
      for (const failedEvent of failedWebhookEvents) {
        try {
          await billingWebhookService.reprocessStoredEvent({
            provider: failedEvent.provider,
            eventPayload: failedEvent.payloadJson
          });
          replayedWebhookCount += 1;
        } catch {
          recordGuardrail("BILLING_WEBHOOK_REPLAY_FAILED", {
            providerEventId: failedEvent.providerEventId
          });
        }
      }
    }

    let webhookRetryMaxAgeSeconds = 0;
    for (const failedEvent of failedWebhookEvents) {
      const eventAgeSeconds = computeAgeSeconds(
        failedEvent.lastFailedAt || failedEvent.updatedAt || failedEvent.receivedAt,
        now
      );
      if (eventAgeSeconds != null) {
        webhookRetryMaxAgeSeconds = Math.max(webhookRetryMaxAgeSeconds, eventAgeSeconds);
      }
    }
    recordGuardrail("BILLING_WEBHOOK_FAILURE_RETRY", {
      measure: "count",
      value: failedWebhookEvents.length
    });
    if (failedWebhookEvents.length > 0) {
      recordGuardrail("BILLING_WEBHOOK_FAILURE_RETRY", {
        measure: "age_seconds",
        value: webhookRetryMaxAgeSeconds
      });
    }

    const scannedCount = pendingRows.length + failedWebhookEvents.length;
    const totalRepaired = repairedCount + replayedWebhookCount;

    return {
      scannedCount,
      repairedCount: totalRepaired,
      driftCount: totalRepaired
    };
  }

  async function reconcileActiveSubscriptions(now) {
    const subscriptions = typeof billingRepository.listCurrentSubscriptions === "function"
      ? await billingRepository.listCurrentSubscriptions({
          provider: activeProvider,
          limit: 300
        })
      : [];

    let repairedCount = 0;

    for (const localSubscription of subscriptions) {
      let providerSubscription = null;
      let providerMissing = false;

      try {
        providerSubscription = await providerAdapter.retrieveSubscription({
          subscriptionId: localSubscription.providerSubscriptionId
        });
      } catch (error) {
        const statusCode = Number(error?.statusCode || error?.status || 0);
        if (statusCode === 404) {
          providerMissing = true;
        } else {
          continue;
        }
      }

      const repaired = await billingRepository.transaction(async (trx) => {
        await lockEntityAggregate({
          billableEntityId: localSubscription.billableEntityId,
          trx
        });

        const lockedSubscription = await billingRepository.findSubscriptionByProviderSubscriptionId(
          {
            provider: activeProvider,
            providerSubscriptionId: localSubscription.providerSubscriptionId
          },
          {
            trx,
            forUpdate: true
          }
        );
        if (!lockedSubscription) {
          return false;
        }

        if (providerMissing) {
          if (!lockedSubscription.isCurrent && String(lockedSubscription.status || "").trim() === "canceled") {
            return false;
          }

          await billingRepository.upsertSubscription(
            {
              billableEntityId: lockedSubscription.billableEntityId,
              planId: lockedSubscription.planId,
              billingCustomerId: lockedSubscription.billingCustomerId,
              provider: lockedSubscription.provider,
              providerSubscriptionId: lockedSubscription.providerSubscriptionId,
              status: "canceled",
              providerSubscriptionCreatedAt: lockedSubscription.providerSubscriptionCreatedAt,
              currentPeriodEnd: lockedSubscription.currentPeriodEnd,
              trialEnd: lockedSubscription.trialEnd,
              canceledAt: lockedSubscription.canceledAt || now,
              cancelAtPeriodEnd: Boolean(lockedSubscription.cancelAtPeriodEnd),
              endedAt: lockedSubscription.endedAt || now,
              isCurrent: false,
              lastProviderEventCreatedAt: now,
              metadataJson: lockedSubscription.metadataJson
            },
            { trx }
          );

          return true;
        }

        const normalizedStatus = normalizeProviderSubscriptionStatus(providerSubscription?.status);
        const shouldBeCurrent = hasCurrentStatus(normalizedStatus);
        const providerCurrentPeriodEnd = parseUnixEpochSeconds(providerSubscription?.current_period_end);
        const providerTrialEnd = parseUnixEpochSeconds(providerSubscription?.trial_end);
        const providerCanceledAt = parseUnixEpochSeconds(providerSubscription?.canceled_at);
        const providerEndedAt = parseUnixEpochSeconds(providerSubscription?.ended_at);
        const providerCreatedAt =
          parseUnixEpochSeconds(providerSubscription?.created) ||
          parseDateOrNull(lockedSubscription.providerSubscriptionCreatedAt) ||
          now;

        const hasDrift =
          String(lockedSubscription.status || "") !== normalizedStatus ||
          Boolean(lockedSubscription.isCurrent) !== shouldBeCurrent ||
          String(lockedSubscription.currentPeriodEnd || "") !== String(providerCurrentPeriodEnd?.toISOString() || "") ||
          String(lockedSubscription.trialEnd || "") !== String(providerTrialEnd?.toISOString() || "") ||
          String(lockedSubscription.canceledAt || "") !== String(providerCanceledAt?.toISOString() || "") ||
          String(lockedSubscription.endedAt || "") !== String(providerEndedAt?.toISOString() || "") ||
          Boolean(lockedSubscription.cancelAtPeriodEnd) !== Boolean(providerSubscription?.cancel_at_period_end);

        if (!hasDrift) {
          return false;
        }

        await billingRepository.upsertSubscription(
          {
            billableEntityId: lockedSubscription.billableEntityId,
            planId: lockedSubscription.planId,
            billingCustomerId: lockedSubscription.billingCustomerId,
            provider: lockedSubscription.provider,
            providerSubscriptionId: lockedSubscription.providerSubscriptionId,
            status: normalizedStatus,
            providerSubscriptionCreatedAt: providerCreatedAt,
            currentPeriodEnd: providerCurrentPeriodEnd,
            trialEnd: providerTrialEnd,
            canceledAt: providerCanceledAt,
            cancelAtPeriodEnd: Boolean(providerSubscription?.cancel_at_period_end),
            endedAt: providerEndedAt,
            isCurrent: shouldBeCurrent,
            lastProviderEventCreatedAt: now,
            metadataJson: toSafeMetadata(providerSubscription?.metadata)
          },
          { trx }
        );

        return true;
      });

      if (repaired) {
        repairedCount += 1;
      }
    }

    return {
      scannedCount: subscriptions.length,
      repairedCount,
      driftCount: repairedCount
    };
  }

  async function reconcileRecentInvoices(now) {
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const invoices = typeof billingRepository.listRecentInvoices === "function"
      ? await billingRepository.listRecentInvoices({
          provider: activeProvider,
          since,
          limit: 500
        })
      : [];

    let repairedCount = 0;

    for (const localInvoice of invoices) {
      let providerInvoice;
      try {
        providerInvoice = await providerAdapter.retrieveInvoice({
          invoiceId: localInvoice.providerInvoiceId
        });
      } catch {
        continue;
      }

      const providerSubscriptionId = toNullableString(providerInvoice?.subscription);
      if (!providerSubscriptionId) {
        continue;
      }

      const subscriptionProbe = await billingRepository.findSubscriptionByProviderSubscriptionId({
        provider: activeProvider,
        providerSubscriptionId
      });
      if (!subscriptionProbe) {
        continue;
      }

      const repaired = await billingRepository.transaction(async (trx) => {
        await lockEntityAggregate({
          billableEntityId: subscriptionProbe.billableEntityId,
          trx
        });

        const lockedSubscription = await billingRepository.findSubscriptionByProviderSubscriptionId(
          {
            provider: activeProvider,
            providerSubscriptionId
          },
          {
            trx,
            forUpdate: true
          }
        );
        if (!lockedSubscription) {
          return false;
        }

        const nextInvoice = {
          subscriptionId: lockedSubscription.id,
          billableEntityId: lockedSubscription.billableEntityId,
          billingCustomerId: lockedSubscription.billingCustomerId,
          provider: activeProvider,
          providerInvoiceId: toNullableString(providerInvoice?.id) || localInvoice.providerInvoiceId,
          status: String(providerInvoice?.status || ""),
          amountDueMinor: Number(providerInvoice?.amount_due || 0),
          amountPaidMinor: Number(providerInvoice?.amount_paid || 0),
          amountRemainingMinor: Number(providerInvoice?.amount_remaining || 0),
          currency: String(providerInvoice?.currency || "").toUpperCase(),
          issuedAt: parseUnixEpochSeconds(providerInvoice?.created),
          dueAt: parseUnixEpochSeconds(providerInvoice?.due_date),
          paidAt: parseUnixEpochSeconds(providerInvoice?.status_transitions?.paid_at),
          lastProviderEventCreatedAt: now,
          metadataJson: toSafeMetadata(providerInvoice?.metadata)
        };

        const hasInvoiceDrift =
          String(localInvoice.status || "") !== String(nextInvoice.status || "") ||
          Number(localInvoice.amountDueMinor || 0) !== Number(nextInvoice.amountDueMinor || 0) ||
          Number(localInvoice.amountPaidMinor || 0) !== Number(nextInvoice.amountPaidMinor || 0) ||
          Number(localInvoice.amountRemainingMinor || 0) !== Number(nextInvoice.amountRemainingMinor || 0);

        const invoiceRow = await billingRepository.upsertInvoice(nextInvoice, { trx });

        const normalizedInvoiceStatus = String(providerInvoice?.status || "").trim().toLowerCase();
        const providerPaymentId =
          toNullableString(providerInvoice?.payment_intent) ||
          toNullableString(providerInvoice?.charge);

        let hasPaymentRepair = false;
        if (
          providerPaymentId &&
          (normalizedInvoiceStatus === "paid" ||
            normalizedInvoiceStatus === "uncollectible" ||
            normalizedInvoiceStatus === "void")
        ) {
          await billingRepository.upsertPayment(
            {
              invoiceId: invoiceRow.id,
              provider: activeProvider,
              providerPaymentId,
              type: "invoice_payment",
              status: normalizedInvoiceStatus === "paid" ? "paid" : "failed",
              amountMinor: Number(providerInvoice?.amount_paid || providerInvoice?.amount_due || 0),
              currency: String(providerInvoice?.currency || "").toUpperCase(),
              paidAt: parseUnixEpochSeconds(providerInvoice?.status_transitions?.paid_at),
              lastProviderEventCreatedAt: now,
              metadataJson: {
                invoiceId: invoiceRow.providerInvoiceId,
                source: "reconciliation"
              }
            },
            { trx }
          );
          hasPaymentRepair = true;
        }

        return hasInvoiceDrift || hasPaymentRepair;
      });

      if (repaired) {
        repairedCount += 1;
      }
    }

    return {
      scannedCount: invoices.length,
      repairedCount,
      driftCount: repairedCount
    };
  }

  async function assertRunFinalization(run, summary, now) {
    const updatedRun = await billingRepository.updateReconciliationRunByLease({
      id: run.id,
      leaseVersion: run.leaseVersion,
      patch: {
        status: "succeeded",
        finishedAt: now,
        leaseVersion: run.leaseVersion + 1,
        leaseExpiresAt: null,
        summaryJson: {
          scannedCount: summary.scannedCount,
          repairedCount: summary.repairedCount,
          driftCount: summary.driftCount
        },
        scannedCount: summary.scannedCount,
        repairedCount: summary.repairedCount,
        driftDetectedCount: summary.driftCount,
        errorText: null
      }
    });

    if (!updatedRun) {
      recordGuardrail("BILLING_RECONCILIATION_LEASE_FENCED", {
        measure: "count",
        value: 1
      });
      throw new AppError(409, "Billing reconciliation lease fenced during finalization.", {
        code: "BILLING_RECONCILIATION_LEASE_FENCED"
      });
    }

    recordGuardrail("BILLING_RECONCILIATION_DRIFT_COUNT", {
      measure: "count",
      value: summary.driftCount
    });
    recordGuardrail("BILLING_RECONCILIATION_REPAIR_COUNT", {
      measure: "count",
      value: summary.repairedCount
    });

    return updatedRun;
  }

  async function markRunFailed(run, error, now) {
    const updated = await billingRepository.updateReconciliationRunByLease({
      id: run.id,
      leaseVersion: run.leaseVersion,
      patch: {
        status: "failed",
        finishedAt: now,
        leaseVersion: run.leaseVersion + 1,
        leaseExpiresAt: null,
        errorText: String(error?.message || "Billing reconciliation failed.")
      }
    });

    if (!updated) {
      recordGuardrail("BILLING_RECONCILIATION_LEASE_FENCED", {
        measure: "count",
        value: 1
      });
    }
  }

  async function runScope({ provider = activeProvider, scope, runnerId, leaseSeconds = 180, now = new Date() }) {
    const normalizedProvider = String(provider || "").trim().toLowerCase();
    if (normalizedProvider !== activeProvider) {
      throw new AppError(400, "Unsupported billing reconciliation provider.");
    }

    const normalizedScope = String(scope || "").trim();
    if (!normalizedScope) {
      throw new AppError(400, "Billing reconciliation scope is required.");
    }

    const lease = await billingRepository.acquireReconciliationRun({
      provider: normalizedProvider,
      scope: normalizedScope,
      runnerId,
      now,
      leaseSeconds
    });

    if (!lease.acquired) {
      return {
        skipped: true,
        reason: "active_run_exists",
        run: lease.run
      };
    }

    const run = lease.run;

    try {
      let summary;
      if (normalizedScope === "checkout_open") {
        summary = await reconcileOpenCheckoutSessions(now);
      } else if (normalizedScope === "checkout_completed_pending") {
        summary = await reconcileCompletedPendingCheckoutSessions(now);
      } else if (normalizedScope === "checkout_recovery_verification") {
        summary = await reconcileRecoveryVerificationCheckoutSessions(now);
      } else if (normalizedScope === "pending_recent") {
        summary = await reconcilePendingRecent(now);
      } else if (normalizedScope === "subscriptions_active") {
        summary = await reconcileActiveSubscriptions(now);
      } else if (normalizedScope === "invoices_recent") {
        summary = await reconcileRecentInvoices(now);
      } else {
        throw new AppError(400, `Unsupported billing reconciliation scope: ${normalizedScope}`);
      }

      const updatedRun = await assertRunFinalization(run, summary, now);

      return {
        skipped: false,
        run: updatedRun,
        summary
      };
    } catch (error) {
      recordGuardrail("BILLING_RECONCILIATION_REPAIR_FAILURE", {
        measure: "count",
        value: 1
      });
      await markRunFailed(run, error, now);
      throw error;
    }
  }

  return {
    runScope
  };
}

const __testables = {
  providerSessionStatusToLocalStatus,
  parseDateOrNull,
  parseUnixEpochSeconds,
  hasCurrentStatus,
  computeAgeSeconds
};

export { createService, __testables };
