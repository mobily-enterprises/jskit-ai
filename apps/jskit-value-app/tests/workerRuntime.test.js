import assert from "node:assert/strict";
import test from "node:test";

import { RETENTION_QUEUE_NAME } from "../server/workers/constants.js";
import { createWorkerRuntime, __testables } from "../server/workers/runtime.js";

test("worker runtime starts/stops BullMQ worker with normalized concurrency", async () => {
  const events = {};
  const calls = {
    processorArgs: null,
    workerCtor: [],
    closes: 0,
    disconnects: 0,
    deadLetterAdds: [],
    deadLetterQueueClosed: 0
  };

  const fakeConnection = {
    async quit() {
      calls.closes += 1;
    },
    disconnect() {
      calls.disconnects += 1;
    }
  };

  class FakeWorker {
    constructor(queueName, processor, options) {
      calls.workerCtor.push({
        queueName,
        processor,
        options
      });
    }

    on(eventName, handler) {
      events[eventName] = handler;
    }

    async waitUntilReady() {}

    async close() {
      calls.workerClosed = true;
    }
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerConcurrency: "5",
    retentionLockTtlMs: 12000,
    retentionConfig: {
      errorLogRetentionDays: 30
    },
    logger: null,
    workerCtor: FakeWorker,
    connectionFactory: () => fakeConnection,
    createRetentionSweepProcessorImpl: (args) => {
      calls.processorArgs = args;
      return async () => ({ ok: true });
    },
    createRetentionDeadLetterQueueImpl: () => ({
      async add(name, payload, options) {
        calls.deadLetterAdds.push({ name, payload, options });
        return {
          id: options.jobId
        };
      },
      async close() {
        calls.deadLetterQueueClosed += 1;
      }
    })
  });

  const startResult = await runtime.start();
  assert.equal(startResult.queue, RETENTION_QUEUE_NAME);
  assert.equal(startResult.concurrency, 5);
  assert.equal(calls.workerCtor.length, 1);
  assert.equal(calls.workerCtor[0].queueName, RETENTION_QUEUE_NAME);
  assert.equal(calls.workerCtor[0].options.connection, fakeConnection);
  assert.equal(calls.workerCtor[0].options.concurrency, 5);
  assert.ok(calls.processorArgs);
  assert.equal(calls.processorArgs.lockConnection, fakeConnection);
  assert.equal(calls.processorArgs.lockTtlMs, 12000);
  assert.equal(typeof events.failed, "function");
  assert.equal(typeof events.error, "function");

  events.failed(
    {
      id: "job_final",
      queueName: RETENTION_QUEUE_NAME,
      attemptsMade: 3,
      opts: {
        attempts: 3
      },
      data: {
        trigger: "cron"
      }
    },
    new Error("failed")
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.deadLetterAdds.length, 1);
  assert.equal(calls.deadLetterAdds[0].payload.jobId, "job_final");

  await runtime.stop();
  assert.equal(calls.workerClosed, true);
  assert.equal(calls.deadLetterQueueClosed, 1);
  assert.equal(calls.closes, 1);
  assert.equal(calls.disconnects, 0);
});

test("worker runtime coalesces concurrent starts into a single worker instance", async () => {
  const calls = {
    workerCtor: 0
  };

  class FakeWorker {
    constructor() {
      calls.workerCtor += 1;
    }

    on() {}

    async waitUntilReady() {
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }

    async close() {}
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    connectionFactory: () => ({
      async quit() {},
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add() {},
      async close() {}
    })
  });

  const [firstStart, secondStart] = await Promise.all([runtime.start(), runtime.start()]);

  assert.equal(calls.workerCtor, 1);
  assert.deepEqual(firstStart, {
    queue: RETENTION_QUEUE_NAME,
    concurrency: 2
  });
  assert.deepEqual(secondStart, firstStart);

  await runtime.stop();
});

test("worker runtime retries lock-held job failures without dead-lettering", async () => {
  const events = {};
  const calls = {
    deadLetterAdds: [],
    lockHeldRetries: []
  };
  const logMessages = [];

  class FakeWorker {
    constructor() {}

    on(eventName, handler) {
      events[eventName] = handler;
    }

    async waitUntilReady() {}

    async close() {}
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    logger: {
      warn(_payload, message) {
        logMessages.push(String(message || ""));
      },
      error(_payload, message) {
        logMessages.push(String(message || ""));
      }
    },
    connectionFactory: () => ({
      async quit() {},
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add(name, payload, options) {
        calls.deadLetterAdds.push({ name, payload, options });
      },
      async close() {}
    })
  });

  await runtime.start();
  const lockHeldJob = {
    id: "job_lock_held",
    queueName: RETENTION_QUEUE_NAME,
    attemptsMade: 3,
    opts: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1
      }
    },
    data: {
      trigger: "manual"
    },
    async retry() {
      calls.lockHeldRetries.push(this.id);
    }
  };

  events.failed(
    lockHeldJob,
    Object.assign(new Error("Retention sweep lock is already held."), {
      name: "RetentionLockHeldError",
      code: "RETENTION_LOCK_HELD"
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.deadLetterAdds.length, 0);
  assert.deepEqual(calls.lockHeldRetries, ["job_lock_held"]);
  assert.equal(logMessages.includes("worker.job.lock_held_retrying"), true);
  assert.equal(logMessages.includes("worker.job.lock_held_requeued"), true);
  assert.equal(logMessages.includes("worker.job.failed"), false);

  await runtime.stop();
});

test("worker runtime only auto-requeues lock-held failures after attempts are exhausted", async () => {
  const events = {};
  const calls = {
    lockHeldRetries: []
  };

  class FakeWorker {
    constructor() {}

    on(eventName, handler) {
      events[eventName] = handler;
    }

    async waitUntilReady() {}

    async close() {}
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    connectionFactory: () => ({
      async quit() {},
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add() {},
      async close() {}
    })
  });

  await runtime.start();
  events.failed(
    {
      id: "job_lock_held_non_terminal",
      queueName: RETENTION_QUEUE_NAME,
      attemptsMade: 1,
      opts: {
        attempts: 3
      },
      async retry() {
        calls.lockHeldRetries.push(this.id);
      }
    },
    Object.assign(new Error("Retention sweep lock is already held."), {
      name: "RetentionLockHeldError",
      code: "RETENTION_LOCK_HELD"
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls.lockHeldRetries, []);

  await runtime.stop();
});

test("worker runtime dead-letters lock-held failures when lock-held requeue budget is exhausted", async () => {
  const events = {};
  const calls = {
    deadLetterAdds: [],
    lockHeldRetries: []
  };
  const logMessages = [];

  class FakeWorker {
    constructor() {}

    on(eventName, handler) {
      events[eventName] = handler;
    }

    async waitUntilReady() {}

    async close() {}
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    lockHeldRequeueMax: 0,
    workerCtor: FakeWorker,
    logger: {
      warn(_payload, message) {
        logMessages.push(String(message || ""));
      },
      error(_payload, message) {
        logMessages.push(String(message || ""));
      }
    },
    connectionFactory: () => ({
      async quit() {},
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add(name, payload, options) {
        calls.deadLetterAdds.push({ name, payload, options });
      },
      async close() {}
    })
  });

  await runtime.start();
  events.failed(
    {
      id: "job_lock_held_exhausted",
      queueName: RETENTION_QUEUE_NAME,
      attemptsMade: 3,
      opts: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1
        }
      },
      async retry() {
        calls.lockHeldRetries.push(this.id);
      }
    },
    Object.assign(new Error("Retention sweep lock is already held."), {
      name: "RetentionLockHeldError",
      code: "RETENTION_LOCK_HELD"
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls.lockHeldRetries, []);
  assert.equal(calls.deadLetterAdds.length, 1);
  assert.equal(calls.deadLetterAdds[0].payload.jobId, "job_lock_held_exhausted");
  assert.equal(calls.deadLetterAdds[0].payload.error.name, "RetentionLockHeldRequeueExhaustedError");
  assert.equal(logMessages.includes("worker.job.lock_held_requeue_exhausted"), true);
  assert.equal(logMessages.includes("worker.job.dead_lettered"), true);

  await runtime.stop();
});

test("worker runtime dead-letters terminal lock-held failures when auto-requeue is unavailable", async () => {
  const events = {};
  const calls = {
    deadLetterAdds: []
  };
  const logMessages = [];

  class FakeWorker {
    constructor() {}

    on(eventName, handler) {
      events[eventName] = handler;
    }

    async waitUntilReady() {}

    async close() {}
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    logger: {
      warn(_payload, message) {
        logMessages.push(String(message || ""));
      },
      error(_payload, message) {
        logMessages.push(String(message || ""));
      }
    },
    connectionFactory: () => ({
      async quit() {},
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add(name, payload, options) {
        calls.deadLetterAdds.push({ name, payload, options });
      },
      async close() {}
    })
  });

  await runtime.start();
  events.failed(
    {
      id: "job_lock_held_unavailable",
      queueName: RETENTION_QUEUE_NAME,
      attemptsMade: 3,
      opts: {
        attempts: 3
      }
    },
    Object.assign(new Error("Retention sweep lock is already held."), {
      name: "RetentionLockHeldError",
      code: "RETENTION_LOCK_HELD"
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.deadLetterAdds.length, 1);
  assert.equal(calls.deadLetterAdds[0].payload.jobId, "job_lock_held_unavailable");
  assert.equal(calls.deadLetterAdds[0].payload.error.name, "RetentionLockHeldRequeueUnavailableError");
  assert.equal(logMessages.includes("worker.job.lock_held_requeue_unavailable"), true);
  assert.equal(logMessages.includes("worker.job.dead_lettered"), true);

  await runtime.stop();
});

test("worker runtime dead-letters terminal lock-held failures when auto-requeue retry throws", async () => {
  const events = {};
  const calls = {
    deadLetterAdds: []
  };
  const logMessages = [];

  class FakeWorker {
    constructor() {}

    on(eventName, handler) {
      events[eventName] = handler;
    }

    async waitUntilReady() {}

    async close() {}
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    logger: {
      warn(_payload, message) {
        logMessages.push(String(message || ""));
      },
      error(_payload, message) {
        logMessages.push(String(message || ""));
      }
    },
    connectionFactory: () => ({
      async quit() {},
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add(name, payload, options) {
        calls.deadLetterAdds.push({ name, payload, options });
      },
      async close() {}
    })
  });

  await runtime.start();
  events.failed(
    {
      id: "job_lock_held_retry_failed",
      queueName: RETENTION_QUEUE_NAME,
      attemptsMade: 3,
      opts: {
        attempts: 3,
        backoff: {
          type: "fixed",
          delay: 1
        }
      },
      async retry() {
        throw new Error("job.retry failed");
      }
    },
    Object.assign(new Error("Retention sweep lock is already held."), {
      name: "RetentionLockHeldError",
      code: "RETENTION_LOCK_HELD"
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(calls.deadLetterAdds.length, 1);
  assert.equal(calls.deadLetterAdds[0].payload.jobId, "job_lock_held_retry_failed");
  assert.equal(calls.deadLetterAdds[0].payload.error.name, "RetentionLockHeldRequeueFailedError");
  assert.equal(logMessages.includes("worker.job.lock_held_requeue_failed"), true);
  assert.equal(logMessages.includes("worker.job.dead_lettered"), true);

  await runtime.stop();
});

test("worker runtime drains in-flight dead-letter enqueues before closing queue resources", async () => {
  const events = {};
  const calls = {
    deadLetterAdds: 0,
    deadLetterAddAfterClose: 0,
    deadLetterQueueClosed: 0
  };

  class FakeWorker {
    constructor() {}

    on(eventName, handler) {
      events[eventName] = handler;
    }

    async waitUntilReady() {}

    async close() {}
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    connectionFactory: () => ({
      async quit() {},
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add() {
        await new Promise((resolve) => {
          setTimeout(resolve, 40);
        });
        if (calls.deadLetterQueueClosed > 0) {
          calls.deadLetterAddAfterClose += 1;
          throw new Error("dead-letter queue already closed");
        }
        calls.deadLetterAdds += 1;
      },
      async close() {
        calls.deadLetterQueueClosed += 1;
      }
    })
  });

  await runtime.start();
  events.failed(
    {
      id: "job_dlq_inflight",
      queueName: RETENTION_QUEUE_NAME,
      attemptsMade: 1,
      opts: {
        attempts: 1
      },
      data: {
        trigger: "manual"
      }
    },
    new Error("terminal failure")
  );

  await runtime.stop();

  assert.equal(calls.deadLetterAdds, 1);
  assert.equal(calls.deadLetterAddAfterClose, 0);
  assert.equal(calls.deadLetterQueueClosed, 1);
});

test("worker runtime concurrency normalizer enforces valid bounds", () => {
  assert.equal(__testables.normalizeConcurrency(3, 2), 3);
  assert.equal(__testables.normalizeConcurrency(0, 2), 2);
  assert.equal(__testables.normalizeConcurrency("1000", 2), 64);
  assert.equal(__testables.normalizeStartupTimeoutMs(750, 9000), 9000);
  assert.equal(__testables.normalizeStartupTimeoutMs(5000, 9000), 5000);
  assert.equal(__testables.normalizeStartupTimeoutMs(300000, 9000), 120000);
  assert.equal(__testables.normalizeLockHeldRequeueDelayMs(0, 5000), 5000);
  assert.equal(__testables.normalizeLockHeldRequeueDelayMs(600000, 5000), 300000);
  assert.equal(__testables.normalizeLockHeldRequeueMax(-1, 3), 3);
  assert.equal(__testables.normalizeLockHeldRequeueMax(4, 3), 4);
  assert.equal(__testables.normalizeLockHeldRequeueMax(5000, 3), 1000);
  assert.equal(
    __testables.resolveLockHeldRequeueCount({
      attemptsMade: 3,
      opts: {
        attempts: 3
      }
    }),
    1
  );
  assert.equal(
    __testables.resolveLockHeldRequeueCount({
      attemptsMade: 7,
      opts: {
        attempts: 3
      }
    }),
    5
  );
});

test("worker runtime stop aborts pending lock-held requeue delay and dead-letters terminal lock-held failure", async () => {
  const events = {};
  const calls = {
    lockHeldRetries: 0,
    deadLetterAdds: 0,
    deadLetterErrorName: ""
  };

  class FakeWorker {
    constructor() {}

    on(eventName, handler) {
      events[eventName] = handler;
    }

    async waitUntilReady() {}

    async close() {}
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    connectionFactory: () => ({
      async quit() {},
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add(_name, payload) {
        calls.deadLetterAdds += 1;
        calls.deadLetterErrorName = String(payload?.error?.name || "");
      },
      async close() {}
    })
  });

  await runtime.start();
  events.failed(
    {
      id: "job_lock_held_stop_abort",
      queueName: RETENTION_QUEUE_NAME,
      attemptsMade: 3,
      opts: {
        attempts: 3,
        backoff: {
          type: "fixed",
          delay: 5000
        }
      },
      async retry() {
        calls.lockHeldRetries += 1;
      }
    },
    Object.assign(new Error("Retention sweep lock is already held."), {
      name: "RetentionLockHeldError",
      code: "RETENTION_LOCK_HELD"
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const startedAtMs = Date.now();
  await runtime.stop();
  const elapsedMs = Date.now() - startedAtMs;

  assert.ok(elapsedMs < 1000);
  assert.equal(calls.lockHeldRetries, 0);
  assert.equal(calls.deadLetterAdds, 1);
  assert.equal(calls.deadLetterErrorName, "RetentionLockHeldRequeueAbortedError");
});

test("worker runtime stop continues closing resources when worker close fails", async () => {
  const calls = {
    deadLetterQueueClosed: 0,
    redisClosed: 0
  };

  class FakeWorker {
    constructor() {}

    on() {}

    async waitUntilReady() {}

    async close() {
      throw new Error("worker close failed");
    }
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    connectionFactory: () => ({
      async quit() {
        calls.redisClosed += 1;
      },
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add() {},
      async close() {
        calls.deadLetterQueueClosed += 1;
      }
    })
  });

  await runtime.start();
  await assert.rejects(() => runtime.stop(), /worker close failed/);
  assert.equal(calls.deadLetterQueueClosed, 1);
  assert.equal(calls.redisClosed, 1);
});

test("worker runtime start cleanup closes remaining resources even if worker close fails", async () => {
  const calls = {
    deadLetterQueueClosed: 0,
    redisClosed: 0
  };

  class FakeWorker {
    constructor() {}

    on() {}

    async waitUntilReady() {
      throw new Error("ready failed");
    }

    async close() {
      throw new Error("worker close failed");
    }
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    connectionFactory: () => ({
      async quit() {
        calls.redisClosed += 1;
      },
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add() {},
      async close() {
        calls.deadLetterQueueClosed += 1;
      }
    })
  });

  await assert.rejects(() => runtime.start(), /ready failed/);
  assert.equal(calls.deadLetterQueueClosed, 1);
  assert.equal(calls.redisClosed, 1);
});

test("worker runtime stop continues redis close when dead-letter queue close fails", async () => {
  const calls = {
    workerClosed: 0,
    redisClosed: 0
  };

  class FakeWorker {
    constructor() {}

    on() {}

    async waitUntilReady() {}

    async close() {
      calls.workerClosed += 1;
    }
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    connectionFactory: () => ({
      async quit() {
        calls.redisClosed += 1;
      },
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add() {},
      async close() {
        throw new Error("dead-letter close failed");
      }
    })
  });

  await runtime.start();
  await assert.rejects(() => runtime.stop(), /dead-letter close failed/);
  assert.equal(calls.workerClosed, 1);
  assert.equal(calls.redisClosed, 1);
});

test("worker runtime start times out and closes resources when worker never becomes ready", async () => {
  const calls = {
    workerClosed: 0,
    deadLetterQueueClosed: 0,
    redisClosed: 0
  };

  class FakeWorker {
    constructor() {}

    on() {}

    async waitUntilReady() {
      return new Promise(() => {});
    }

    async close() {
      calls.workerClosed += 1;
    }
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    workerStartupTimeoutMs: 1000,
    connectionFactory: () => ({
      async quit() {
        calls.redisClosed += 1;
      },
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add() {},
      async close() {
        calls.deadLetterQueueClosed += 1;
      }
    })
  });

  await assert.rejects(() => runtime.start(), /failed to become ready/i);
  assert.equal(calls.workerClosed, 1);
  assert.equal(calls.deadLetterQueueClosed, 1);
  assert.equal(calls.redisClosed, 1);
});

test("worker runtime logs startup errors only once before ready", async () => {
  const logs = [];
  const events = {};

  class FakeWorker {
    constructor() {}

    on(eventName, handler) {
      events[eventName] = handler;
    }

    async waitUntilReady() {
      events.error?.(new Error("startup connect failed #1"));
      events.error?.(new Error("startup connect failed #2"));
      events.error?.(new Error("startup connect failed #3"));
      throw new Error("ready failed");
    }

    async close() {}
  }

  const runtime = createWorkerRuntime({
    redisUrl: "redis://localhost:6379/1",
    workerCtor: FakeWorker,
    logger: {
      error(_payload, message) {
        logs.push(String(message || ""));
      }
    },
    connectionFactory: () => ({
      async quit() {},
      disconnect() {}
    }),
    createRetentionSweepProcessorImpl: () => async () => ({ ok: true }),
    createRetentionDeadLetterQueueImpl: () => ({
      async add() {},
      async close() {}
    })
  });

  await assert.rejects(() => runtime.start(), /ready failed/);
  const startupRuntimeErrorLogs = logs.filter((message) => message === "worker.runtime.error");
  assert.equal(startupRuntimeErrorLogs.length, 1);
});
