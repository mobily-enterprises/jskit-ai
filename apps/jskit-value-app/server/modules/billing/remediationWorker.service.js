import { AppError } from "../../lib/errors.js";

function createService(options = {}) {
  const {
    billingRepository,
    billingProviderAdapter,
    retryDelaySeconds = 120,
    maxAttempts = 6,
    observabilityService = null
  } = options;
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
  const providerAdapter = billingProviderAdapter;
  const activeProvider = String(providerAdapter?.provider || "")
    .trim()
    .toLowerCase();

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
    const remediationProvider = String(remediation?.provider || "")
      .trim()
      .toLowerCase();
    if (remediationProvider && activeProvider && remediationProvider !== activeProvider) {
      throw new AppError(
        409,
        `Remediation provider mismatch: expected "${activeProvider}" but received "${remediationProvider}".`,
        {
          code: "BILLING_PROVIDER_MISMATCH"
        }
      );
    }

    const duplicateProviderSubscriptionId = String(remediation?.duplicateProviderSubscriptionId || "").trim();
    if (!duplicateProviderSubscriptionId) {
      throw new AppError(400, "Duplicate provider subscription id is required for remediation.");
    }

    if (!providerAdapter || typeof providerAdapter.cancelSubscription !== "function") {
      throw new AppError(501, "Provider subscription cancellation is not available.");
    }

    await providerAdapter.cancelSubscription({
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

    async function patchLeasedRemediationOrThrow(patch) {
      const updated = await billingRepository.updateRemediationByLease({
        id: remediationId,
        leaseVersion: fencedRemediation.leaseVersion,
        patch
      });

      if (!updated) {
        recordGuardrail("BILLING_REMEDIATION_LEASE_FENCED", {
          measure: "count",
          value: 1
        });
        throw new AppError(409, "Remediation lease fencing mismatch.", {
          code: "BILLING_REMEDIATION_LEASE_FENCED"
        });
      }

      return updated;
    }

    if (attemptCount >= normalizedMaxAttempts) {
      recordGuardrail("BILLING_REMEDIATION_DEAD_LETTER", {
        measure: "attempt_count",
        value: attemptCount
      });
      return patchLeasedRemediationOrThrow({
        ...basePatch,
        status: "dead_letter",
        resolvedAt: now
      });
    }

    const nextAttemptAt = new Date(now.getTime() + normalizedRetryDelaySeconds * 1000 * attemptCount);

    return patchLeasedRemediationOrThrow({
      ...basePatch,
      status: "failed",
      nextAttemptAt
    });
  }

  return {
    leaseNextRemediation,
    runCancelDuplicateSubscription,
    retryOrDeadLetterRemediation
  };
}

export { createService };
