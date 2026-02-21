import { Queue } from "bullmq";
import { RETENTION_DEAD_LETTER_JOB_NAME, RETENTION_DEAD_LETTER_QUEUE_NAME } from "./constants.js";

const DEFAULT_DEAD_LETTER_JOB_OPTIONS = Object.freeze({
  attempts: 1,
  removeOnComplete: Object.freeze({
    age: 30 * 24 * 60 * 60,
    count: 20_000
  }),
  removeOnFail: Object.freeze({
    age: 30 * 24 * 60 * 60,
    count: 50_000
  })
});

function serializeError(error) {
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || "Unknown worker failure"),
    stack: String(error?.stack || "").slice(0, 8000)
  };
}

function buildDeadLetterPayload({ job, error }) {
  const attemptsMade = Number(job?.attemptsMade || 0);
  const maxAttempts = Number(job?.opts?.attempts || 0);
  const jobId = String(job?.id || "");

  return {
    failedAt: new Date().toISOString(),
    queue: String(job?.queueName || ""),
    jobId,
    attemptsMade,
    maxAttempts,
    payload: job?.data && typeof job.data === "object" ? { ...job.data } : {},
    error: serializeError(error)
  };
}

function createRetentionDeadLetterQueue({ connection, queueCtor = Queue } = {}) {
  if (!connection) {
    throw new Error("BullMQ connection is required.");
  }

  return new queueCtor(RETENTION_DEAD_LETTER_QUEUE_NAME, {
    connection
  });
}

async function enqueueRetentionDeadLetterJob({ queue, job, error, jobOptions = {} } = {}) {
  if (!queue || typeof queue.add !== "function") {
    throw new Error("BullMQ dead-letter queue is required.");
  }

  const payload = buildDeadLetterPayload({ job, error });
  const idSuffix = payload.jobId || "unknown";

  return queue.add(RETENTION_DEAD_LETTER_JOB_NAME, payload, {
    ...DEFAULT_DEAD_LETTER_JOB_OPTIONS,
    jobId: `dlq:${idSuffix}:${payload.attemptsMade}`,
    ...(jobOptions && typeof jobOptions === "object" ? jobOptions : {})
  });
}

const __testables = {
  DEFAULT_DEAD_LETTER_JOB_OPTIONS,
  serializeError,
  buildDeadLetterPayload
};

export { createRetentionDeadLetterQueue, enqueueRetentionDeadLetterJob, __testables };
