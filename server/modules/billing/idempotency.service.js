import { AppError } from "../../lib/errors.js";
import {
  BILLING_ACTIONS,
  BILLING_CHECKOUT_SESSION_STATUS,
  BILLING_DEFAULT_PROVIDER,
  BILLING_FAILURE_CODES,
  BILLING_IDEMPOTENCY_STATUS,
  BILLING_RUNTIME_DEFAULTS
} from "./constants.js";
import { toHmacSha256Hex } from "./canonicalJson.js";

function parseMajorVersion(version) {
  const match = String(version || "")
    .trim()
    .match(/^(\d+)/);
  if (!match) {
    return null;
  }

  const major = Number(match[1]);
  if (!Number.isInteger(major) || major < 0) {
    return null;
  }

  return major;
}

function isLeaseExpired(idempotencyRow, now = new Date()) {
  const expiresAt = new Date(idempotencyRow?.pendingLeaseExpiresAt || 0);
  if (Number.isNaN(expiresAt.getTime())) {
    return true;
  }

  return expiresAt.getTime() <= now.getTime();
}

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

function createService({
  billingRepository,
  operationKeySecret,
  providerIdempotencyKeySecret,
  pendingLeaseSeconds = BILLING_RUNTIME_DEFAULTS.CHECKOUT_PENDING_LEASE_SECONDS,
  checkoutSessionGraceSeconds = BILLING_RUNTIME_DEFAULTS.CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS,
  observabilityService = null
}) {
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (typeof billingRepository.transaction !== "function") {
    throw new Error("billingRepository.transaction is required.");
  }
  if (typeof billingRepository.findIdempotencyByEntityActionClientKey !== "function") {
    throw new Error("billingRepository.findIdempotencyByEntityActionClientKey is required.");
  }
  if (typeof billingRepository.insertIdempotency !== "function") {
    throw new Error("billingRepository.insertIdempotency is required.");
  }
  if (typeof billingRepository.updateIdempotencyById !== "function") {
    throw new Error("billingRepository.updateIdempotencyById is required.");
  }
  if (typeof billingRepository.listPendingIdempotencyRows !== "function") {
    throw new Error("billingRepository.listPendingIdempotencyRows is required.");
  }
  if (!String(operationKeySecret || "").trim()) {
    throw new Error("operationKeySecret is required.");
  }
  if (!String(providerIdempotencyKeySecret || "").trim()) {
    throw new Error("providerIdempotencyKeySecret is required.");
  }

  const leaseSeconds = Math.max(10, Number(pendingLeaseSeconds) || BILLING_RUNTIME_DEFAULTS.CHECKOUT_PENDING_LEASE_SECONDS);
  const checkoutGraceSeconds = Math.max(
    0,
    Number(checkoutSessionGraceSeconds) || BILLING_RUNTIME_DEFAULTS.CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS
  );

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

  function buildOperationKey({ action, billableEntityId, clientIdempotencyKey }) {
    const input = `${String(action || "").trim()}|${Number(billableEntityId)}|${String(clientIdempotencyKey || "").trim()}`;
    return toHmacSha256Hex(operationKeySecret, input);
  }

  function buildProviderIdempotencyKey({ provider, action, operationKey }) {
    const input = `${String(provider || BILLING_DEFAULT_PROVIDER).trim()}|${String(action || "").trim()}|${String(operationKey || "").trim()}`;
    return toHmacSha256Hex(providerIdempotencyKeySecret, input);
  }

  function assertIdempotencyFingerprintMatch(row, requestFingerprintHash) {
    if (String(row?.requestFingerprintHash || "") === String(requestFingerprintHash || "")) {
      return;
    }

    throw new AppError(409, "Idempotency key already used with a different request payload.", {
      code: BILLING_FAILURE_CODES.IDEMPOTENCY_CONFLICT,
      details: {
        code: BILLING_FAILURE_CODES.IDEMPOTENCY_CONFLICT
      }
    });
  }

  async function claimOrReplayInTransaction(
    trx,
    {
      action,
      billableEntityId,
      clientIdempotencyKey,
      requestFingerprintHash,
      normalizedRequestJson,
      provider = BILLING_DEFAULT_PROVIDER,
      now = new Date()
    }
  ) {
    const normalizedAction = String(action || "").trim();
    if (
      normalizedAction !== BILLING_ACTIONS.CHECKOUT &&
      normalizedAction !== BILLING_ACTIONS.PORTAL &&
      normalizedAction !== BILLING_ACTIONS.PAYMENT_LINK
    ) {
      throw new AppError(400, "Unsupported billing idempotency action.");
    }

    const normalizedClientKey = String(clientIdempotencyKey || "").trim();
    if (!normalizedClientKey) {
      throw new AppError(400, "Idempotency-Key header is required.");
    }

    const existing = await billingRepository.findIdempotencyByEntityActionClientKey(
      {
        billableEntityId,
        action: normalizedAction,
        clientIdempotencyKey: normalizedClientKey
      },
      { trx, forUpdate: true }
    );

    if (existing) {
      assertIdempotencyFingerprintMatch(existing, requestFingerprintHash);

      if (existing.status === BILLING_IDEMPOTENCY_STATUS.SUCCEEDED) {
        return {
          type: "replay_succeeded",
          row: existing
        };
      }

      if (existing.status === BILLING_IDEMPOTENCY_STATUS.FAILED || existing.status === BILLING_IDEMPOTENCY_STATUS.EXPIRED) {
        return {
          type: "replay_terminal",
          row: existing
        };
      }

      if (!isLeaseExpired(existing, now)) {
        return {
          type: "in_progress_same_key",
          row: existing
        };
      }

      return {
        type: "recover_pending",
        row: existing
      };
    }

    if (normalizedAction === BILLING_ACTIONS.CHECKOUT) {
      const pendingCheckout = await billingRepository.findPendingCheckoutIdempotencyForEntity(billableEntityId, {
        trx,
        forUpdate: true
      });
      if (pendingCheckout && pendingCheckout.clientIdempotencyKey !== normalizedClientKey) {
        return {
          type: "checkout_in_progress_other_key",
          row: pendingCheckout
        };
      }
    }

    const operationKey = buildOperationKey({
      action: normalizedAction,
      billableEntityId,
      clientIdempotencyKey: normalizedClientKey
    });

    const providerIdempotencyKey = buildProviderIdempotencyKey({
      provider,
      action: normalizedAction,
      operationKey
    });

    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);

    try {
      const inserted = await billingRepository.insertIdempotency(
        {
          billableEntityId,
          action: normalizedAction,
          clientIdempotencyKey: normalizedClientKey,
          requestFingerprintHash,
          normalizedRequestJson,
          operationKey,
          provider,
          providerIdempotencyKey,
          status: BILLING_IDEMPOTENCY_STATUS.PENDING,
          pendingLeaseExpiresAt: leaseExpiresAt,
          pendingLastHeartbeatAt: now,
          leaseVersion: 1,
          recoveryAttemptCount: 0
        },
        { trx }
      );

      return {
        type: "claimed",
        row: inserted
      };
    } catch (error) {
      const duplicate = await billingRepository.findIdempotencyByEntityActionClientKey(
        {
          billableEntityId,
          action: normalizedAction,
          clientIdempotencyKey: normalizedClientKey
        },
        { trx, forUpdate: true }
      );

      if (duplicate) {
        assertIdempotencyFingerprintMatch(duplicate, requestFingerprintHash);

        if (duplicate.status === BILLING_IDEMPOTENCY_STATUS.SUCCEEDED) {
          return {
            type: "replay_succeeded",
            row: duplicate
          };
        }

        if (duplicate.status === BILLING_IDEMPOTENCY_STATUS.FAILED || duplicate.status === BILLING_IDEMPOTENCY_STATUS.EXPIRED) {
          return {
            type: "replay_terminal",
            row: duplicate
          };
        }

        if (!isLeaseExpired(duplicate, now)) {
          return {
            type: "in_progress_same_key",
            row: duplicate
          };
        }

        return {
          type: "recover_pending",
          row: duplicate
        };
      }

      if (normalizedAction === BILLING_ACTIONS.CHECKOUT) {
        const checkoutDuplicate = await billingRepository.findPendingCheckoutIdempotencyForEntity(billableEntityId, {
          trx,
          forUpdate: true
        });
        if (checkoutDuplicate) {
          return {
            type: "checkout_in_progress_other_key",
            row: checkoutDuplicate
          };
        }
      }

      throw error;
    }
  }

  async function claimOrReplay(params, options = {}) {
    const trx = options?.trx || null;
    if (trx) {
      return claimOrReplayInTransaction(trx, params);
    }

    return billingRepository.transaction(async (innerTrx) => claimOrReplayInTransaction(innerTrx, params));
  }

  async function recoverPendingRequest({ idempotencyRowId, leaseOwner, now = new Date() }) {
    return billingRepository.transaction(async (trx) => {
      const row = await billingRepository.findIdempotencyById(idempotencyRowId, {
        trx,
        forUpdate: true
      });

      if (!row) {
        throw new AppError(404, "Billing idempotency request not found.");
      }

      if (row.status !== BILLING_IDEMPOTENCY_STATUS.PENDING) {
        return {
          type: "not_pending",
          row
        };
      }

      if (!isLeaseExpired(row, now)) {
        return {
          type: "lease_active",
          row
        };
      }

      const nextLeaseVersion = Number(row.leaseVersion || 0) + 1;
      const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);

      const updated = await billingRepository.updateIdempotencyById(
        row.id,
        {
          pendingLeaseExpiresAt: leaseExpiresAt,
          pendingLastHeartbeatAt: now,
          leaseOwner: String(leaseOwner || "").trim() || null,
          leaseVersion: nextLeaseVersion,
          recoveryAttemptCount: Number(row.recoveryAttemptCount || 0) + 1,
          lastRecoveryAttemptAt: now
        },
        { trx }
      );

      return {
        type: "recovery_leased",
        row: updated,
        expectedLeaseVersion: nextLeaseVersion
      };
    });
  }

  async function assertLeaseVersion({ idempotencyRowId, leaseVersion }, options = {}) {
    const row = await billingRepository.findIdempotencyById(idempotencyRowId, options);
    if (!row) {
      throw new AppError(404, "Billing idempotency request not found.");
    }

    if (Number(row.leaseVersion) !== Number(leaseVersion)) {
      recordGuardrail("BILLING_IDEMPOTENCY_LEASE_FENCED", {
        operationKey: row.operationKey,
        billableEntityId: row.billableEntityId
      });
      throw new AppError(409, "Billing idempotency lease has changed.", {
        code: "BILLING_LEASE_FENCED",
        details: {
          code: "BILLING_LEASE_FENCED"
        }
      });
    }

    return row;
  }

  async function assertProviderRequestHashStable({ idempotencyRowId, candidateProviderRequestHash }) {
    const row = await billingRepository.findIdempotencyById(idempotencyRowId);
    if (!row) {
      throw new AppError(404, "Billing idempotency request not found.");
    }

    if (!row.providerRequestHash) {
      throw new AppError(500, "Provider request hash is missing from idempotency state.");
    }

    if (String(row.providerRequestHash) !== String(candidateProviderRequestHash || "")) {
      recordGuardrail("BILLING_PROVIDER_REQUEST_HASH_MISMATCH", {
        operationKey: row.operationKey,
        billableEntityId: row.billableEntityId
      });
      throw new AppError(409, "Provider request hash mismatch.", {
        code: "BILLING_PROVIDER_REQUEST_HASH_MISMATCH",
        details: {
          code: "BILLING_PROVIDER_REQUEST_HASH_MISMATCH"
        }
      });
    }

    return row;
  }

  function assertProviderReplayWindowOpen({ idempotencyRow, now = new Date() }) {
    const deadline = new Date(idempotencyRow?.providerIdempotencyReplayDeadlineAt || 0);
    if (Number.isNaN(deadline.getTime())) {
      throw new AppError(500, "Provider replay deadline missing from idempotency state.");
    }

    if (deadline.getTime() <= now.getTime()) {
      throw new AppError(409, "Checkout recovery replay window elapsed.", {
        code: BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED,
        details: {
          code: BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED
        }
      });
    }
  }

  function throwReplayProvenanceMismatch(idempotencyRow) {
    const correlationContext = {
      operationKey: idempotencyRow?.operationKey,
      billableEntityId: idempotencyRow?.billableEntityId
    };

    recordGuardrail("BILLING_STRIPE_SDK_API_BASELINE_DRIFT", {
      ...correlationContext,
      measure: "count",
      value: 1
    });
    recordGuardrail("BILLING_CHECKOUT_REPLAY_PROVENANCE_MISMATCH", correlationContext);

    throw new AppError(409, "Checkout replay provenance mismatch.", {
      code: BILLING_FAILURE_CODES.CHECKOUT_REPLAY_PROVENANCE_MISMATCH,
      details: {
        code: BILLING_FAILURE_CODES.CHECKOUT_REPLAY_PROVENANCE_MISMATCH
      }
    });
  }

  function assertReplayProvenanceCompatible({ idempotencyRow, runtimeProviderSdkVersion, runtimeProviderApiVersion }) {
    const persistedApiVersion = String(idempotencyRow?.providerApiVersion || "").trim();
    const runtimeApiVersion = String(runtimeProviderApiVersion || "").trim();
    if (!persistedApiVersion || !runtimeApiVersion || persistedApiVersion !== runtimeApiVersion) {
      throwReplayProvenanceMismatch(idempotencyRow);
    }

    const persistedSdkMajor = parseMajorVersion(idempotencyRow?.providerSdkVersion);
    const runtimeSdkMajor = parseMajorVersion(runtimeProviderSdkVersion);
    if (persistedSdkMajor == null || runtimeSdkMajor == null || persistedSdkMajor !== runtimeSdkMajor) {
      throwReplayProvenanceMismatch(idempotencyRow);
    }
  }

  async function markSucceeded({ idempotencyRowId, responseJson, providerSessionId, leaseVersion = null }, options = {}) {
    const updated = await billingRepository.updateIdempotencyById(
      idempotencyRowId,
      {
        status: BILLING_IDEMPOTENCY_STATUS.SUCCEEDED,
        responseJson,
        providerSessionId,
        pendingLeaseExpiresAt: null,
        pendingLastHeartbeatAt: null,
        leaseOwner: null
      },
      leaseVersion != null
        ? {
            ...options,
            expectedLeaseVersion: leaseVersion
          }
        : options
    );

    if (leaseVersion != null && !updated) {
      const existing = await billingRepository.findIdempotencyById(idempotencyRowId, options);
      if (!existing) {
        throw new AppError(404, "Billing idempotency request not found.");
      }

      recordGuardrail("BILLING_IDEMPOTENCY_LEASE_FENCED", {
        operationKey: existing.operationKey,
        billableEntityId: existing.billableEntityId
      });
      throw new AppError(409, "Billing idempotency lease has changed.", {
        code: "BILLING_LEASE_FENCED",
        details: {
          code: "BILLING_LEASE_FENCED"
        }
      });
    }

    return updated;
  }

  async function markFailed({ idempotencyRowId, failureCode, failureReason, leaseVersion = null }, options = {}) {
    const updated = await billingRepository.updateIdempotencyById(
      idempotencyRowId,
      {
        status: BILLING_IDEMPOTENCY_STATUS.FAILED,
        failureCode,
        failureReason,
        pendingLeaseExpiresAt: null,
        pendingLastHeartbeatAt: null,
        leaseOwner: null
      },
      leaseVersion != null
        ? {
            ...options,
            expectedLeaseVersion: leaseVersion
          }
        : options
    );

    if (leaseVersion != null && !updated) {
      const existing = await billingRepository.findIdempotencyById(idempotencyRowId, options);
      if (!existing) {
        throw new AppError(404, "Billing idempotency request not found.");
      }

      recordGuardrail("BILLING_IDEMPOTENCY_LEASE_FENCED", {
        operationKey: existing.operationKey,
        billableEntityId: existing.billableEntityId
      });
      throw new AppError(409, "Billing idempotency lease has changed.", {
        code: "BILLING_LEASE_FENCED",
        details: {
          code: "BILLING_LEASE_FENCED"
        }
      });
    }

    return updated;
  }

  async function markExpired({ idempotencyRowId, failureCode, failureReason, leaseVersion = null }, options = {}) {
    const updated = await billingRepository.updateIdempotencyById(
      idempotencyRowId,
      {
        status: BILLING_IDEMPOTENCY_STATUS.EXPIRED,
        failureCode,
        failureReason,
        pendingLeaseExpiresAt: null,
        pendingLastHeartbeatAt: null,
        leaseOwner: null
      },
      leaseVersion != null
        ? {
            ...options,
            expectedLeaseVersion: leaseVersion
          }
        : options
    );

    if (leaseVersion != null && !updated) {
      const existing = await billingRepository.findIdempotencyById(idempotencyRowId, options);
      if (!existing) {
        throw new AppError(404, "Billing idempotency request not found.");
      }

      recordGuardrail("BILLING_IDEMPOTENCY_LEASE_FENCED", {
        operationKey: existing.operationKey,
        billableEntityId: existing.billableEntityId
      });
      throw new AppError(409, "Billing idempotency lease has changed.", {
        code: "BILLING_LEASE_FENCED",
        details: {
          code: "BILLING_LEASE_FENCED"
        }
      });
    }

    return updated;
  }

  function supportsEntityScopedAggregateLocking() {
    return (
      typeof billingRepository.findBillableEntityById === "function" &&
      typeof billingRepository.lockSubscriptionsForEntity === "function" &&
      typeof billingRepository.lockCheckoutSessionsForEntity === "function"
    );
  }

  function supportsRecoveryHoldMaterialization() {
    return (
      supportsEntityScopedAggregateLocking() &&
      typeof billingRepository.findCheckoutSessionByProviderOperationKey === "function" &&
      typeof billingRepository.updateCheckoutSessionById === "function" &&
      typeof billingRepository.upsertCheckoutSessionByOperationKey === "function"
    );
  }

  async function lockPendingRowAggregate({ billableEntityId, idempotencyRowId, trx }) {
    if (supportsEntityScopedAggregateLocking()) {
      await billingRepository.findBillableEntityById(billableEntityId, {
        trx,
        forUpdate: true
      });
      await billingRepository.lockSubscriptionsForEntity(billableEntityId, {
        trx,
        forUpdate: true
      });
    }

    const lockedPendingRow = await billingRepository.findIdempotencyById(idempotencyRowId, {
      trx,
      forUpdate: true
    });

    if (supportsEntityScopedAggregateLocking()) {
      await billingRepository.lockCheckoutSessionsForEntity(billableEntityId, {
        trx,
        forUpdate: true
      });
    }

    return lockedPendingRow;
  }

  async function materializeRecoveryVerificationHold({ pendingRow, holdExpiresAt, now, trx }) {
    if (!supportsRecoveryHoldMaterialization()) {
      return false;
    }

    const operationKey = String(pendingRow?.operationKey || "").trim();
    const provider =
      String(pendingRow?.provider || BILLING_DEFAULT_PROVIDER)
        .trim()
        .toLowerCase() || BILLING_DEFAULT_PROVIDER;
    if (!operationKey) {
      return false;
    }

    const correlatedSession = await billingRepository.findCheckoutSessionByProviderOperationKey(
      {
        provider,
        operationKey
      },
      {
        trx,
        forUpdate: true
      }
    );

    if (correlatedSession) {
      const correlatedStatus = String(correlatedSession.status || "").trim();
      if (
        correlatedStatus === BILLING_CHECKOUT_SESSION_STATUS.OPEN ||
        correlatedStatus === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION ||
        correlatedStatus === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_RECONCILED ||
        correlatedStatus === BILLING_CHECKOUT_SESSION_STATUS.EXPIRED ||
        correlatedStatus === BILLING_CHECKOUT_SESSION_STATUS.ABANDONED
      ) {
        return false;
      }

      if (correlatedStatus === BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING) {
        const mergedHoldExpiresAt = pickLaterDate(correlatedSession.expiresAt, holdExpiresAt);
        await billingRepository.updateCheckoutSessionById(
          correlatedSession.id,
          {
            expiresAt: mergedHoldExpiresAt,
            lastProviderEventCreatedAt: now
          },
          { trx }
        );
        return true;
      }

      return false;
    }

    await billingRepository.upsertCheckoutSessionByOperationKey(
      {
        billableEntityId: pendingRow.billableEntityId,
        provider,
        providerCheckoutSessionId: null,
        idempotencyRowId: pendingRow.id,
        operationKey,
        status: BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING,
        expiresAt: holdExpiresAt,
        lastProviderEventCreatedAt: now
      },
      { trx }
    );
    return true;
  }

  async function expireStalePendingRequests({ olderThanSeconds = leaseSeconds, limit = 200, now = new Date() } = {}) {
    const staleWindowSeconds = Math.max(1, Number(olderThanSeconds) || leaseSeconds);
    const staleBefore = new Date(now.getTime() - staleWindowSeconds * 1000);
    let updatedRows = 0;

    const pendingRows = await billingRepository.listPendingIdempotencyRows({
      action: BILLING_ACTIONS.CHECKOUT,
      staleBefore,
      limit
    });

    for (const pendingRow of pendingRows) {
      const rowUpdated = await billingRepository.transaction(async (trx) => {
        const lockedPendingRow = await lockPendingRowAggregate({
          billableEntityId: pendingRow.billableEntityId,
          idempotencyRowId: pendingRow.id,
          trx
        });
        if (!lockedPendingRow || lockedPendingRow.status !== BILLING_IDEMPOTENCY_STATUS.PENDING) {
          return false;
        }

        const providerSessionId = String(lockedPendingRow.providerSessionId || "").trim();
        if (providerSessionId) {
          return false;
        }

        const replayDeadlineAt = toDateOrNull(lockedPendingRow.providerIdempotencyReplayDeadlineAt);
        const sessionUpperBound = toDateOrNull(lockedPendingRow.providerCheckoutSessionExpiresAtUpperBound);
        const operationKey = String(lockedPendingRow.operationKey || "").trim();

        const hasInvalidRecoveryMetadata = !replayDeadlineAt || !sessionUpperBound || !operationKey;
        if (hasInvalidRecoveryMetadata) {
          await billingRepository.updateIdempotencyById(
            lockedPendingRow.id,
            {
              status: BILLING_IDEMPOTENCY_STATUS.FAILED,
              failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
              failureReason:
                "Pending checkout recovery metadata is invalid during stale-request cleanup.",
              pendingLeaseExpiresAt: null,
              pendingLastHeartbeatAt: null,
              leaseOwner: null
            },
            { trx }
          );
          return true;
        }

        if (now.getTime() < replayDeadlineAt.getTime()) {
          return false;
        }

        const holdRiskUntil = new Date(sessionUpperBound.getTime() + checkoutGraceSeconds * 1000);
        if (now.getTime() < holdRiskUntil.getTime()) {
          await materializeRecoveryVerificationHold({
            pendingRow: lockedPendingRow,
            holdExpiresAt: holdRiskUntil,
            now,
            trx
          });
        }

        await billingRepository.updateIdempotencyById(
          lockedPendingRow.id,
          {
            status: BILLING_IDEMPOTENCY_STATUS.EXPIRED,
            failureCode: BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED,
            failureReason: "Pending checkout idempotency exceeded replay deadline during stale-request cleanup.",
            pendingLeaseExpiresAt: null,
            pendingLastHeartbeatAt: null,
            leaseOwner: null
          },
          { trx }
        );

        return true;
      });

      if (rowUpdated) {
        updatedRows += 1;
      }
    }

    return { updatedRows };
  }

  return {
    buildOperationKey,
    buildProviderIdempotencyKey,
    claimOrReplay,
    recoverPendingRequest,
    expireStalePendingRequests,
    assertProviderRequestHashStable,
    assertLeaseVersion,
    assertProviderReplayWindowOpen,
    assertReplayProvenanceCompatible,
    markSucceeded,
    markFailed,
    markExpired
  };
}

const __testables = {
  parseMajorVersion,
  isLeaseExpired
};

export { createService, __testables };
