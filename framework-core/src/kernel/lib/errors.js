class KernelError extends Error {
  constructor(message, details = {}) {
    super(String(message || "Kernel error."));
    this.name = this.constructor.name;
    this.details = details && typeof details === "object" ? { ...details } : {};
  }
}

class ProviderNormalizationError extends KernelError {}
class DuplicateProviderError extends KernelError {}
class ProviderDependencyError extends KernelError {}
class ProviderLifecycleError extends KernelError {}

export {
  KernelError,
  ProviderNormalizationError,
  DuplicateProviderError,
  ProviderDependencyError,
  ProviderLifecycleError
};
