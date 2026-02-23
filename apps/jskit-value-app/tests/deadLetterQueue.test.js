import assert from "node:assert/strict";
import test from "node:test";

import { RETENTION_DEAD_LETTER_JOB_NAME, RETENTION_DEAD_LETTER_QUEUE_NAME } from "../server/workers/constants.js";
import {
  createRetentionDeadLetterQueue,
  enqueueRetentionDeadLetterJob,
  __testables
} from "../server/workers/deadLetterQueue.js";

test("dead-letter queue payload mapper serializes job and error details", () => {
  const payload = __testables.buildDeadLetterPayload({
    job: {
      id: "job_1",
      queueName: "ops.retention",
      attemptsMade: 3,
      opts: {
        attempts: 3
      },
      data: {
        dryRun: false
      }
    },
    error: new Error("boom")
  });

  assert.equal(payload.jobId, "job_1");
  assert.equal(payload.queue, "ops.retention");
  assert.equal(payload.attemptsMade, 3);
  assert.equal(payload.maxAttempts, 3);
  assert.equal(payload.payload.dryRun, false);
  assert.equal(payload.error.message, "boom");
});

test("createRetentionDeadLetterQueue validates connection and queue name", () => {
  class FakeQueue {
    constructor(name, options) {
      this.name = name;
      this.options = options;
    }
  }

  assert.throws(() => createRetentionDeadLetterQueue({ queueCtor: FakeQueue }), /connection is required/);

  const queue = createRetentionDeadLetterQueue({
    connection: {
      id: "conn_1"
    },
    queueCtor: FakeQueue
  });

  assert.equal(queue.name, RETENTION_DEAD_LETTER_QUEUE_NAME);
  assert.equal(queue.options.connection.id, "conn_1");
});

test("enqueueRetentionDeadLetterJob adds stable failed-job payload with deterministic id", async () => {
  const calls = [];
  const queue = {
    async add(name, payload, options) {
      calls.push({
        name,
        payload,
        options
      });
      return {
        id: options.jobId
      };
    }
  };

  const result = await enqueueRetentionDeadLetterJob({
    queue,
    job: {
      id: "job_777",
      queueName: "ops.retention",
      attemptsMade: 3,
      opts: {
        attempts: 3
      },
      data: {
        trigger: "cron"
      }
    },
    error: new Error("failed")
  });

  assert.equal(result.id, "dlq:job_777:3");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, RETENTION_DEAD_LETTER_JOB_NAME);
  assert.equal(calls[0].payload.payload.trigger, "cron");
  assert.equal(calls[0].options.attempts, 1);
});
