import { BILLING_DEFAULT_PROVIDER } from "./constants.js";

function toMs(seconds, fallbackSeconds) {
  const normalizedSeconds = Math.max(1, Number(seconds) || Number(fallbackSeconds) || 1);
  return normalizedSeconds * 1000;
}

function createService({
  enabled = false,
  billingOutboxWorkerService,
  billingRemediationWorkerService,
  billingReconciliationService,
  reconciliationProvider = BILLING_DEFAULT_PROVIDER,
  logger = console,
  workerIdPrefix = `billing:${process.pid}`,
  outboxPollSeconds = 5,
  remediationPollSeconds = 10,
  reconciliationPendingRecentSeconds = 15 * 60,
  reconciliationCheckoutOpenSeconds = 30 * 60,
  reconciliationCheckoutCompletedSeconds = 10 * 60,
  reconciliationCheckoutRecoverySeconds = 10 * 60,
  reconciliationSubscriptionsSeconds = 6 * 60 * 60,
  reconciliationInvoicesSeconds = 24 * 60 * 60
}) {
  if (!billingOutboxWorkerService) {
    throw new Error("billingOutboxWorkerService is required.");
  }
  if (!billingRemediationWorkerService) {
    throw new Error("billingRemediationWorkerService is required.");
  }
  if (!billingReconciliationService) {
    throw new Error("billingReconciliationService is required.");
  }

  const billingEnabled = enabled === true;
  const normalizedReconciliationProvider = String(reconciliationProvider || BILLING_DEFAULT_PROVIDER)
    .trim()
    .toLowerCase() || BILLING_DEFAULT_PROVIDER;
  let started = false;
  const timers = new Set();
  const runningFlags = new Set();

  function logInfo(payload, message) {
    if (logger && typeof logger.info === "function") {
      logger.info(payload, message);
    }
  }

  function logWarn(payload, message) {
    if (logger && typeof logger.warn === "function") {
      logger.warn(payload, message);
    }
  }

  function clearTimers() {
    for (const timer of timers) {
      clearInterval(timer);
    }
    timers.clear();
  }

  async function runExclusive(name, fn) {
    if (runningFlags.has(name)) {
      return;
    }

    runningFlags.add(name);
    try {
      await fn();
    } catch (error) {
      logWarn(
        {
          name,
          error: String(error?.message || error)
        },
        "billing.worker.loop.failed"
      );
    } finally {
      runningFlags.delete(name);
    }
  }

  async function tickOutbox() {
    const workerId = `${workerIdPrefix}:outbox`;
    const maxJobsPerTick = 25;

    for (let processedCount = 0; processedCount < maxJobsPerTick; processedCount += 1) {
      const lease = await billingOutboxWorkerService.leaseNextJob({
        workerId
      });
      if (!lease?.job) {
        return;
      }

      try {
        await billingOutboxWorkerService.executeJob({
          jobId: lease.job.id,
          leaseVersion: lease.leaseVersion
        });
      } catch (error) {
        await billingOutboxWorkerService.retryOrDeadLetter({
          jobId: lease.job.id,
          leaseVersion: lease.leaseVersion,
          error
        });
      }
    }
  }

  async function tickRemediation() {
    const workerId = `${workerIdPrefix}:remediation`;
    const maxRemediationsPerTick = 10;

    for (let processedCount = 0; processedCount < maxRemediationsPerTick; processedCount += 1) {
      const lease = await billingRemediationWorkerService.leaseNextRemediation({
        workerId
      });
      if (!lease?.remediation) {
        return;
      }

      try {
        await billingRemediationWorkerService.runCancelDuplicateSubscription({
          remediationId: lease.remediation.id,
          leaseVersion: lease.leaseVersion
        });
      } catch (error) {
        await billingRemediationWorkerService.retryOrDeadLetterRemediation({
          remediationId: lease.remediation.id,
          leaseVersion: lease.leaseVersion,
          error
        });
      }
    }
  }

  async function runReconciliationScope(scope) {
    const runnerId = `${workerIdPrefix}:reconciliation:${scope}`;
    await billingReconciliationService.runScope({
      provider: normalizedReconciliationProvider,
      scope,
      runnerId
    });
  }

  function registerInterval(name, intervalMs, fn) {
    const run = () => runExclusive(name, fn);
    const timer = setInterval(run, intervalMs);
    timer.unref?.();
    timers.add(timer);
    run().catch(() => {});
  }

  function start() {
    if (started || !billingEnabled) {
      return;
    }

    started = true;

    registerInterval("outbox", toMs(outboxPollSeconds, 5), tickOutbox);
    registerInterval("remediation", toMs(remediationPollSeconds, 10), tickRemediation);

    registerInterval(
      "reconciliation:pending_recent",
      toMs(reconciliationPendingRecentSeconds, 15 * 60),
      async () => runReconciliationScope("pending_recent")
    );
    registerInterval(
      "reconciliation:checkout_open",
      toMs(reconciliationCheckoutOpenSeconds, 30 * 60),
      async () => runReconciliationScope("checkout_open")
    );
    registerInterval(
      "reconciliation:checkout_completed_pending",
      toMs(reconciliationCheckoutCompletedSeconds, 10 * 60),
      async () => runReconciliationScope("checkout_completed_pending")
    );
    registerInterval(
      "reconciliation:checkout_recovery_verification",
      toMs(reconciliationCheckoutRecoverySeconds, 10 * 60),
      async () => runReconciliationScope("checkout_recovery_verification")
    );
    registerInterval(
      "reconciliation:subscriptions_active",
      toMs(reconciliationSubscriptionsSeconds, 6 * 60 * 60),
      async () => runReconciliationScope("subscriptions_active")
    );
    registerInterval(
      "reconciliation:invoices_recent",
      toMs(reconciliationInvoicesSeconds, 24 * 60 * 60),
      async () => runReconciliationScope("invoices_recent")
    );

    logInfo(
      {
        workerIdPrefix
      },
      "billing.worker.runtime.started"
    );
  }

  function stop() {
    if (!started) {
      return;
    }

    clearTimers();
    started = false;
    runningFlags.clear();

    logInfo(
      {
        workerIdPrefix
      },
      "billing.worker.runtime.stopped"
    );
  }

  function isStarted() {
    return started;
  }

  return {
    start,
    stop,
    isStarted
  };
}

const __testables = {
  toMs
};

export { createService, __testables };
