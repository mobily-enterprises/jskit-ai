import { ensureNonEmptyText, normalizeArray } from "@jskit-ai/support-core/normalize";
import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createJobRegistry } from "./jobRegistry.js";
import { JobDispatchError, WorkerLifecycleError } from "./errors.js";

class WorkerKernel {
  constructor({ jobRegistry = null } = {}) {
    this.jobRegistry = jobRegistry || createJobRegistry();
    this.queue = [];
    this.started = false;
    this.running = false;
  }

  registerJob(definition) {
    this.jobRegistry.register(definition);
    return this;
  }

  async start() {
    if (this.started) {
      return this;
    }
    this.started = true;
    return this;
  }

  async stop() {
    this.started = false;
    this.running = false;
    return this;
  }

  dispatch(jobId, payload = {}, context = {}) {
    const id = ensureNonEmptyText(jobId, "job id");
    if (!this.jobRegistry.has(id)) {
      throw new JobDispatchError(`Job \"${id}\" is not registered.`);
    }

    const envelope = Object.freeze({ id, payload, context });
    this.queue.push(envelope);
    return envelope;
  }

  async drain({ maxJobs = Number.POSITIVE_INFINITY } = {}) {
    if (!this.started) {
      throw new WorkerLifecycleError("Cannot drain queue before worker is started.");
    }
    if (this.running) {
      throw new WorkerLifecycleError("Worker is already draining jobs.");
    }

    this.running = true;
    const completed = [];

    try {
      const budget = Number.isFinite(Number(maxJobs)) ? Math.max(0, Math.trunc(Number(maxJobs))) : Number.POSITIVE_INFINITY;
      while (this.queue.length > 0 && completed.length < budget) {
        const next = this.queue.shift();
        const definition = this.jobRegistry.get(next.id);
        if (!definition) {
          throw new JobDispatchError(`Job \"${next.id}\" is not registered.`);
        }

        const result = await definition.run(next.payload, next.context);
        completed.push({
          id: next.id,
          result
        });
      }

      return Object.freeze(completed);
    } finally {
      this.running = false;
    }
  }

  pendingJobs() {
    return Object.freeze(normalizeArray(this.queue));
  }
}

function createWorkerKernel(options = {}) {
  return new WorkerKernel(options);
}

function registerQueueRuntime(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.make !== "function") {
    throw new WorkerLifecycleError("registerQueueRuntime requires application container methods.");
  }

  app.singleton(TOKENS.QueueRegistry, () => createJobRegistry());
  app.singleton(TOKENS.WorkerKernel, (scope) => {
    const jobRegistry = scope.make(TOKENS.QueueRegistry);
    return createWorkerKernel({ jobRegistry });
  });

  return app.make(TOKENS.WorkerKernel);
}

export { WorkerKernel, createWorkerKernel, registerQueueRuntime };
