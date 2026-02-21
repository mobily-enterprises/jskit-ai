import { AppError } from "../../lib/errors.js";

function createService({
  billingRepository,
  stripeSdkService,
  retryDelaySeconds = 60,
  maxAttempts = 8,
  observabilityService = null
}) {
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (typeof billingRepository.leaseNextOutboxJob !== "function") {
    throw new Error("billingRepository.leaseNextOutboxJob is required.");
  }
  if (typeof billingRepository.updateOutboxJobByLease !== "function") {
    throw new Error("billingRepository.updateOutboxJobByLease is required.");
  }
  if (!stripeSdkService || typeof stripeSdkService.expireCheckoutSession !== "function") {
    throw new Error("stripeSdkService.expireCheckoutSession is required.");
  }

  const normalizedRetryDelaySeconds = Math.max(1, Number(retryDelaySeconds) || 1);
  const normalizedMaxAttempts = Math.max(1, Number(maxAttempts) || 1);

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

  async function leaseNextJob({ workerId, leaseSeconds = 60, now = new Date() }) {
    const leased = await billingRepository.leaseNextOutboxJob({
      workerId,
      leaseSeconds,
      now
    });

    if (!leased) {
      return null;
    }

    return {
      job: leased,
      leaseVersion: leased.leaseVersion
    };
  }

  async function runExpireCheckoutSession(payload) {
    const providerSessionId = String(payload?.providerCheckoutSessionId || "").trim();
    if (!providerSessionId) {
      throw new AppError(400, "Outbox expire_checkout_session payload missing providerCheckoutSessionId.");
    }

    await stripeSdkService.expireCheckoutSession({
      sessionId: providerSessionId
    });
  }

  async function executeJob({ jobId, leaseVersion }) {
    const leasedJob = await billingRepository.updateOutboxJobByLease({
      id: jobId,
      leaseVersion,
      patch: {}
    });
    if (!leasedJob) {
      recordGuardrail("BILLING_OUTBOX_LEASE_FENCED", {
        measure: "count",
        value: 1
      });
      throw new AppError(409, "Outbox lease fencing mismatch.", {
        code: "BILLING_OUTBOX_LEASE_FENCED"
      });
    }

    const payload = leasedJob.payloadJson || {};
    const jobType = String(leasedJob.jobType || "").trim();

    if (jobType === "expire_checkout_session") {
      recordGuardrail("BILLING_ORPHAN_CHECKOUT_SESSION_CLEANUP_ATTEMPT", {
        measure: "count",
        value: 1
      });
      await runExpireCheckoutSession(payload);
    } else if (jobType === "cancel_duplicate_subscription") {
      // Duplicate subscription cancellation is executed by remediation worker.
    }

    const nextLeaseVersion = Number(leasedJob.leaseVersion || leaseVersion) + 1;

    const completed = await billingRepository.updateOutboxJobByLease({
      id: jobId,
      leaseVersion: leasedJob.leaseVersion,
      patch: {
        status: "succeeded",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseVersion: nextLeaseVersion,
        lastErrorText: null
      }
    });

    if (!completed) {
      recordGuardrail("BILLING_OUTBOX_LEASE_FENCED", {
        measure: "count",
        value: 1
      });
      throw new AppError(409, "Outbox lease fencing mismatch.", {
        code: "BILLING_OUTBOX_LEASE_FENCED"
      });
    }

    return completed;
  }

  async function retryOrDeadLetter({ jobId, leaseVersion, error, now = new Date() }) {
    const fencedJob = await billingRepository.updateOutboxJobByLease({
      id: jobId,
      leaseVersion,
      patch: {}
    });
    if (!fencedJob) {
      recordGuardrail("BILLING_OUTBOX_LEASE_FENCED", {
        measure: "count",
        value: 1
      });
      throw new AppError(409, "Outbox lease fencing mismatch.", {
        code: "BILLING_OUTBOX_LEASE_FENCED"
      });
    }

    const jobType = String(fencedJob.jobType || "").trim();
    if (jobType === "expire_checkout_session") {
      recordGuardrail("BILLING_ORPHAN_CHECKOUT_SESSION_CLEANUP_FAILURE", {
        measure: "count",
        value: 1
      });
    }

    const attemptCount = Number(fencedJob.attemptCount || 0) + 1;
    const nextLeaseVersion = Number(fencedJob.leaseVersion || leaseVersion) + 1;
    const basePatch = {
      attemptCount,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseVersion: nextLeaseVersion,
      lastErrorText: String(error?.message || "Outbox worker execution failed.")
    };

    if (attemptCount >= normalizedMaxAttempts) {
      recordGuardrail("BILLING_OUTBOX_DEAD_LETTER", {
        measure: "attempt_count",
        value: attemptCount
      });
      return billingRepository.updateOutboxJobByLease({
        id: jobId,
        leaseVersion: fencedJob.leaseVersion,
        patch: {
          ...basePatch,
          status: "dead_letter",
          finishedAt: now
        }
      });
    }

    const nextAvailableAt = new Date(now.getTime() + normalizedRetryDelaySeconds * 1000 * attemptCount);

    return billingRepository.updateOutboxJobByLease({
      id: jobId,
      leaseVersion: fencedJob.leaseVersion,
      patch: {
        ...basePatch,
        status: "failed",
        availableAt: nextAvailableAt
      }
    });
  }

  return {
    leaseNextJob,
    executeJob,
    retryOrDeadLetter,
    runExpireCheckoutSession
  };
}

export { createService };
