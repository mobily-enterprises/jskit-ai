import { createHash } from "node:crypto";
import { Queue } from "bullmq";
import { RETENTION_QUEUE_NAME, RETENTION_SWEEP_JOB_NAME } from "./constants.js";

const DEFAULT_RETENTION_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: Object.freeze({
    type: "exponential",
    delay: 5000
  }),
  removeOnComplete: Object.freeze({
    age: 24 * 60 * 60,
    count: 1000
  }),
  removeOnFail: Object.freeze({
    age: 7 * 24 * 60 * 60,
    count: 5000
  })
});

function hashIdempotencyKey(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 12);
}

function normalizeIdempotencyKey(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "";
  }

  const sanitized = normalized
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!sanitized) {
    return "";
  }

  if (sanitized.length <= 160) {
    return sanitized;
  }

  const hashSuffix = `-${hashIdempotencyKey(sanitized)}`;
  const prefixLength = Math.max(1, 160 - hashSuffix.length);
  return `${sanitized.slice(0, prefixLength)}${hashSuffix}`;
}

function buildCronIdempotencyKey({ now = new Date(), dryRun = false } = {}) {
  const isoDate = new Date(now).toISOString().slice(0, 10);
  return `cron-${isoDate}-${dryRun ? "dry-run" : "run"}`;
}

function normalizeLabel(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || fallback;
}

function normalizeRequestedBy(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "system";
  }

  return normalized.slice(0, 128);
}

function normalizeRetentionSweepPayload(payload = {}) {
  const explicitIdempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey);
  const resolvedIdempotencyKey =
    explicitIdempotencyKey ||
    (normalizeLabel(payload.trigger, "manual") === "cron"
      ? buildCronIdempotencyKey({
          now: payload.now || new Date(),
          dryRun: Boolean(payload.dryRun)
        })
      : "");

  return {
    dryRun: Boolean(payload.dryRun),
    trigger: normalizeLabel(payload.trigger, "manual"),
    requestedBy: normalizeRequestedBy(payload.requestedBy),
    idempotencyKey: resolvedIdempotencyKey
  };
}

function normalizeRequestedIdempotencyKey(value) {
  return String(value || "").trim();
}

function createRetentionQueue({ connection, queueCtor = Queue } = {}) {
  if (!connection) {
    throw new Error("BullMQ connection is required.");
  }

  return new queueCtor(RETENTION_QUEUE_NAME, {
    connection
  });
}

async function enqueueRetentionSweep({ queue, payload = {}, jobOptions = {} } = {}) {
  if (!queue || typeof queue.add !== "function") {
    throw new Error("BullMQ queue is required.");
  }

  const normalizedPayload = normalizeRetentionSweepPayload(payload);
  const requestedIdempotencyKey = normalizeRequestedIdempotencyKey(payload?.idempotencyKey);
  if (requestedIdempotencyKey && !normalizedPayload.idempotencyKey) {
    throw new Error("Idempotency key must include at least one valid character (a-z, 0-9, underscore, or hyphen).");
  }
  const queueJobOptions = {
    ...DEFAULT_RETENTION_JOB_OPTIONS,
    ...(jobOptions && typeof jobOptions === "object" ? jobOptions : {})
  };

  if (!queueJobOptions.jobId && normalizedPayload.idempotencyKey) {
    queueJobOptions.jobId = `retention-${normalizedPayload.idempotencyKey}`;
  }

  return queue.add(RETENTION_SWEEP_JOB_NAME, normalizedPayload, queueJobOptions);
}

const __testables = {
  DEFAULT_RETENTION_JOB_OPTIONS,
  normalizeLabel,
  normalizeRequestedBy,
  normalizeRequestedIdempotencyKey,
  hashIdempotencyKey,
  normalizeIdempotencyKey,
  buildCronIdempotencyKey,
  normalizeRetentionSweepPayload
};

export { createRetentionQueue, enqueueRetentionSweep, normalizeRetentionSweepPayload, __testables };
