class KernelError extends Error {
  constructor(message, details = {}) {
    const normalizedDetails = details && typeof details === "object" ? { ...details } : {};
    const hasCause = Object.prototype.hasOwnProperty.call(normalizedDetails, "cause");
    super(
      String(message || "Kernel error."),
      hasCause ? { cause: normalizedDetails.cause } : undefined
    );
    this.name = this.constructor.name;
    this.details = normalizedDetails;
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
