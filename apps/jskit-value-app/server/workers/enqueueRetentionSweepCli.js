function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const triggerArg = args.find((entry) => String(entry || "").startsWith("--trigger="));
  const requestedByArg = args.find((entry) => String(entry || "").startsWith("--requested-by="));
  const idempotencyKeyArg = args.find((entry) => String(entry || "").startsWith("--idempotency-key="));

  return {
    dryRun: args.includes("--dry-run"),
    trigger: triggerArg ? String(triggerArg).slice("--trigger=".length) : "manual",
    requestedBy: requestedByArg ? String(requestedByArg).slice("--requested-by=".length) : "cli",
    idempotencyKey: idempotencyKeyArg ? String(idempotencyKeyArg).slice("--idempotency-key=".length) : ""
  };
}

function resolveEnqueuedIdempotencyKey({ job } = {}) {
  return String(job?.data?.idempotencyKey || "").trim();
}

function buildEnqueueOutput({ queueName, job, dryRun } = {}) {
  const idempotencyKey = resolveEnqueuedIdempotencyKey({ job });
  return {
    queue: String(queueName || ""),
    jobId: String(job?.id || ""),
    dryRun: Boolean(dryRun),
    idempotencyKey,
    idempotencyApplied: Boolean(idempotencyKey)
  };
}

const __testables = {
  resolveEnqueuedIdempotencyKey
};

export { parseCliArgs, buildEnqueueOutput, __testables };
