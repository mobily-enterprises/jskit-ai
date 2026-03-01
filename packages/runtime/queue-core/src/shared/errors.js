class QueueKernelError extends Error {
  constructor(message, details = {}) {
    super(String(message || "Queue kernel error."));
    this.name = this.constructor.name;
    this.details = details && typeof details === "object" ? { ...details } : {};
  }
}

class JobRegistrationError extends QueueKernelError {}
class JobDispatchError extends QueueKernelError {}
class WorkerLifecycleError extends QueueKernelError {}

export { QueueKernelError, JobRegistrationError, JobDispatchError, WorkerLifecycleError };
