import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { createGuardrailRecorder, withLeaseFence } from "@jskit-ai/billing-core";

function createService(options = {}) {
  const {
    billingRepository,
    billingProviderAdapter,
    retryDelaySeconds = 60,
    maxAttempts = 8,
    observabilityService = null
  } = options;
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (typeof billingRepository.leaseNextOutboxJob !== "function") {
    throw new Error("billingRepository.leaseNextOutboxJob is required.");
  }
  if (typeof billingRepository.updateOutboxJobByLease !== "function") {
    throw new Error("billingRepository.updateOutboxJobByLease is required.");
  }
  const providerAdapter = billingProviderAdapter;
  if (!providerAdapter || typeof providerAdapter.expireCheckoutSession !== "function") {
    throw new Error("billingProviderAdapter.expireCheckoutSession is required.");
  }
  const activeProvider = String(providerAdapter?.provider || "")
    .trim()
    .toLowerCase();

  const normalizedRetryDelaySeconds = Math.max(1, Number(retryDelaySeconds) || 1);
  const normalizedMaxAttempts = Math.max(1, Number(maxAttempts) || 1);

  const recordGuardrail = createGuardrailRecorder(observabilityService);

  async function updateOutboxJobOrThrow({ jobId, leaseVersion, patch }) {
    return withLeaseFence({
      update: (nextPatch) =>
        billingRepository.updateOutboxJobByLease({
          id: jobId,
          leaseVersion,
          patch: nextPatch
        }),
      patch,
      guardrailRecorder: recordGuardrail,
      guardrailCode: "BILLING_OUTBOX_LEASE_FENCED",
      errorMessage: "Outbox lease fencing mismatch.",
      errorCode: "BILLING_OUTBOX_LEASE_FENCED"
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
    const payloadProvider = String(payload?.provider || "")
      .trim()
      .toLowerCase();
    if (payloadProvider && activeProvider && payloadProvider !== activeProvider) {
      throw new AppError(
        409,
        `Outbox provider mismatch: expected "${activeProvider}" but received "${payloadProvider}".`,
        {
          code: "BILLING_PROVIDER_MISMATCH"
        }
      );
    }

    const providerSessionId = String(payload?.providerCheckoutSessionId || "").trim();
    if (!providerSessionId) {
      throw new AppError(400, "Outbox expire_checkout_session payload missing providerCheckoutSessionId.");
    }

    await providerAdapter.expireCheckoutSession({
      sessionId: providerSessionId
    });
  }

  async function executeJob({ jobId, leaseVersion }) {
    const leasedJob = await updateOutboxJobOrThrow({
      jobId,
      leaseVersion,
      patch: {}
    });

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

    const completed = await updateOutboxJobOrThrow({
      jobId,
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

    return completed;
  }

  async function retryOrDeadLetter({ jobId, leaseVersion, error, now = new Date() }) {
    const fencedJob = await updateOutboxJobOrThrow({
      jobId,
      leaseVersion,
      patch: {}
    });

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

    async function patchLeasedJobOrThrow(patch) {
      return updateOutboxJobOrThrow({
        jobId,
        leaseVersion: fencedJob.leaseVersion,
        patch
      });
    }

    if (attemptCount >= normalizedMaxAttempts) {
      recordGuardrail("BILLING_OUTBOX_DEAD_LETTER", {
        measure: "attempt_count",
        value: attemptCount
      });
      return patchLeasedJobOrThrow({
        ...basePatch,
        status: "dead_letter",
        finishedAt: now
      });
    }

    const nextAvailableAt = new Date(now.getTime() + normalizedRetryDelaySeconds * 1000 * attemptCount);

    return patchLeasedJobOrThrow({
      ...basePatch,
      status: "failed",
      availableAt: nextAvailableAt
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
