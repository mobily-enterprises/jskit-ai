import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { createGuardrailRecorder, withLeaseFence } from "@jskit-ai/billing-core/server";

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

  const recordGuardrail = createGuardrailRecorder(observabilityService);

  async function updateRemediationOrThrow({ remediationId, leaseVersion, patch }) {
    return withLeaseFence({
      update: (nextPatch) =>
        billingRepository.updateRemediationByLease({
          id: remediationId,
          leaseVersion,
          patch: nextPatch
        }),
      patch,
      guardrailRecorder: recordGuardrail,
      guardrailCode: "BILLING_REMEDIATION_LEASE_FENCED",
      errorMessage: "Remediation lease fencing mismatch.",
      errorCode: "BILLING_REMEDIATION_LEASE_FENCED"
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
    const fencedRemediation = await updateRemediationOrThrow({
      remediationId,
      leaseVersion,
      patch: {}
    });

    await executeCancelDuplicateSubscription(fencedRemediation);

    const nextLeaseVersion = Number(fencedRemediation.leaseVersion || leaseVersion) + 1;

    const completed = await updateRemediationOrThrow({
      remediationId,
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

    return completed;
  }

  async function retryOrDeadLetterRemediation({ remediationId, leaseVersion, error, now = new Date() }) {
    const fencedRemediation = await updateRemediationOrThrow({
      remediationId,
      leaseVersion,
      patch: {}
    });

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
      return updateRemediationOrThrow({
        remediationId,
        leaseVersion: fencedRemediation.leaseVersion,
        patch
      });
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
