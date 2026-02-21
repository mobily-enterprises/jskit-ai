import { AppError } from "../../lib/errors.js";

function createService({
  billingRepository,
  stripeSdkService,
  retryDelaySeconds = 120,
  maxAttempts = 6,
  observabilityService = null
}) {
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (typeof billingRepository.leaseNextRemediation !== "function") {
    throw new Error("billingRepository.leaseNextRemediation is required.");
  }
  if (typeof billingRepository.updateRemediationByLease !== "function") {
    throw new Error("billingRepository.updateRemediationByLease is required.");
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

  async function leaseNextRemediation({ workerId, leaseSeconds = 90, now = new Date() }) {
    const leased = await billingRepository.leaseNextRemediation({
      workerId,
      leaseSeconds,
      now
    });

    if (!leased) {
      return null;
    }

    return {
      remediation: leased,
      leaseVersion: leased.leaseVersion
    };
  }

  async function executeCancelDuplicateSubscription(remediation) {
    const duplicateProviderSubscriptionId = String(remediation?.duplicateProviderSubscriptionId || "").trim();
    if (!duplicateProviderSubscriptionId) {
      throw new AppError(400, "Duplicate provider subscription id is required for remediation.");
    }

    if (!stripeSdkService || typeof stripeSdkService.cancelSubscription !== "function") {
      throw new AppError(501, "Stripe subscription cancellation is not available.");
    }

    await stripeSdkService.cancelSubscription({
      subscriptionId: duplicateProviderSubscriptionId
    });
  }

  async function runCancelDuplicateSubscription({ remediationId, leaseVersion }) {
    const fencedRemediation = await billingRepository.updateRemediationByLease({
      id: remediationId,
      leaseVersion,
      patch: {}
    });
    if (!fencedRemediation) {
      recordGuardrail("BILLING_REMEDIATION_LEASE_FENCED", {
        measure: "count",
        value: 1
      });
      throw new AppError(409, "Remediation lease fencing mismatch.", {
        code: "BILLING_REMEDIATION_LEASE_FENCED"
      });
    }

    await executeCancelDuplicateSubscription(fencedRemediation);

    const nextLeaseVersion = Number(fencedRemediation.leaseVersion || leaseVersion) + 1;

    const completed = await billingRepository.updateRemediationByLease({
      id: remediationId,
      leaseVersion: fencedRemediation.leaseVersion,
      patch: {
        status: "succeeded",
        resolvedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseVersion: nextLeaseVersion,
        errorText: null,
        lastAttemptAt: new Date(),
        attemptCount: Number(fencedRemediation.attemptCount || 0) + 1
      }
    });

    if (!completed) {
      recordGuardrail("BILLING_REMEDIATION_LEASE_FENCED", {
        measure: "count",
        value: 1
      });
      throw new AppError(409, "Remediation lease fencing mismatch.", {
        code: "BILLING_REMEDIATION_LEASE_FENCED"
      });
    }

    return completed;
  }

  async function retryOrDeadLetterRemediation({ remediationId, leaseVersion, error, now = new Date() }) {
    const fencedRemediation = await billingRepository.updateRemediationByLease({
      id: remediationId,
      leaseVersion,
      patch: {}
    });
    if (!fencedRemediation) {
      recordGuardrail("BILLING_REMEDIATION_LEASE_FENCED", {
        measure: "count",
        value: 1
      });
      throw new AppError(409, "Remediation lease fencing mismatch.", {
        code: "BILLING_REMEDIATION_LEASE_FENCED"
      });
    }

    const attemptCount = Number(fencedRemediation.attemptCount || 0) + 1;
    const nextLeaseVersion = Number(fencedRemediation.leaseVersion || leaseVersion) + 1;
    const basePatch = {
      attemptCount,
      lastAttemptAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseVersion: nextLeaseVersion,
      errorText: String(error?.message || "Remediation execution failed.")
    };

    if (attemptCount >= normalizedMaxAttempts) {
      recordGuardrail("BILLING_REMEDIATION_DEAD_LETTER", {
        measure: "attempt_count",
        value: attemptCount
      });
      return billingRepository.updateRemediationByLease({
        id: remediationId,
        leaseVersion: fencedRemediation.leaseVersion,
        patch: {
          ...basePatch,
          status: "dead_letter",
          resolvedAt: now
        }
      });
    }

    const nextAttemptAt = new Date(now.getTime() + normalizedRetryDelaySeconds * 1000 * attemptCount);

    return billingRepository.updateRemediationByLease({
      id: remediationId,
      leaseVersion: fencedRemediation.leaseVersion,
      patch: {
        ...basePatch,
        status: "failed",
        nextAttemptAt
      }
    });
  }

  return {
    leaseNextRemediation,
    runCancelDuplicateSubscription,
    retryOrDeadLetterRemediation
  };
}

export { createService };
