import assert from "node:assert/strict";
import test from "node:test";

import { RETENTION_QUEUE_NAME, RETENTION_SWEEP_JOB_NAME } from "../server/workers/constants.js";
import { createRetentionQueue, enqueueRetentionSweep, __testables } from "../server/workers/retentionQueue.js";

test("retention queue payload normalizers enforce stable defaults", () => {
  assert.equal(__testables.normalizeLabel("  CrOn ", "manual"), "cron");
  assert.equal(__testables.normalizeLabel("", "manual"), "manual");
  assert.equal(__testables.normalizeRequestedBy(""), "system");
  assert.equal(__testables.normalizeRequestedBy("abc"), "abc");
  assert.equal(__testables.normalizeIdempotencyKey(" Sched/Run#1 "), "sched-run-1");
  assert.equal(
    __testables.buildCronIdempotencyKey({
      now: "2026-02-21T10:22:00.000Z",
      dryRun: true
    }),
    "cron-2026-02-21-dry-run"
  );

  const payload = __testables.normalizeRetentionSweepPayload({
    dryRun: 1,
    trigger: "  cron ",
    requestedBy: " ops ",
    now: "2026-02-21T10:22:00.000Z"
  });
  assert.deepEqual(payload, {
    dryRun: true,
    trigger: "cron",
    requestedBy: "ops",
    idempotencyKey: "cron-2026-02-21-dry-run"
  });
});

test("idempotency key normalization avoids collisions for overlong keys", () => {
  const longPrefix = "a".repeat(170);
  const normalizedA = __testables.normalizeIdempotencyKey(`${longPrefix}x`);
  const normalizedB = __testables.normalizeIdempotencyKey(`${longPrefix}y`);

  assert.equal(normalizedA.length, 160);
  assert.equal(normalizedB.length, 160);
  assert.notEqual(normalizedA, normalizedB);
  assert.equal(__testables.normalizeIdempotencyKey(`${longPrefix}x`), normalizedA);
  assert.match(normalizedA, /-[a-f0-9]{12}$/);
  assert.match(normalizedB, /-[a-f0-9]{12}$/);
});

test("createRetentionQueue requires connection and configures BullMQ queue name", () => {
  const calls = {
    name: "",
    options: null
  };

  class FakeQueue {
    constructor(name, options) {
      calls.name = name;
      calls.options = options;
    }
  }

  assert.throws(() => createRetentionQueue({ queueCtor: FakeQueue }), /connection is required/);

  const queue = createRetentionQueue({
    connection: { id: "conn_1" },
    queueCtor: FakeQueue
  });

  assert.ok(queue);
  assert.equal(calls.name, RETENTION_QUEUE_NAME);
  assert.equal(calls.options.connection.id, "conn_1");
});

test("enqueueRetentionSweep pushes normalized payload with retry/backoff defaults", async () => {
  const calls = [];
  const queue = {
    async add(name, payload, options) {
      calls.push({ name, payload, options });
      return {
        id: "job_1"
      };
    }
  };

  const job = await enqueueRetentionSweep({
    queue,
    payload: {
      dryRun: "truthy",
      trigger: "  scheduler ",
      requestedBy: "automation",
      idempotencyKey: "manual-run-42"
    }
  });

  assert.equal(job.id, "job_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, RETENTION_SWEEP_JOB_NAME);
  assert.deepEqual(calls[0].payload, {
    dryRun: true,
    trigger: "scheduler",
    requestedBy: "automation",
    idempotencyKey: "manual-run-42"
  });
  assert.equal(calls[0].options.jobId, "retention-manual-run-42");
  assert.equal(calls[0].options.attempts, 3);
  assert.equal(calls[0].options.backoff.type, "exponential");
});

test("enqueueRetentionSweep maps cron idempotency keys to BullMQ-safe job ids", async () => {
  const calls = [];
  const queue = {
    async add(name, payload, options) {
      calls.push({ name, payload, options });
      return {
        id: options.jobId
      };
    }
  };

  await enqueueRetentionSweep({
    queue,
    payload: {
      trigger: "cron",
      dryRun: false,
      now: "2026-02-21T10:22:00.000Z"
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.jobId, "retention-cron-2026-02-21-run");
  assert.equal(calls[0].options.jobId.includes(":"), false);
});

test("enqueueRetentionSweep rejects explicit idempotency keys that normalize to empty", async () => {
  const queue = {
    async add() {
      throw new Error("should not enqueue");
    }
  };

  await assert.rejects(
    () =>
      enqueueRetentionSweep({
        queue,
        payload: {
          idempotencyKey: "!!!"
        }
      }),
    /Idempotency key must include at least one valid character/
  );
});
