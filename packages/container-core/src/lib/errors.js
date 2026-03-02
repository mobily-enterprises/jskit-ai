class ContainerError extends Error {
  constructor(message, details = {}) {
    super(String(message || "Container error."));
    this.name = this.constructor.name;
    this.details = details && typeof details === "object" ? { ...details } : {};
  }
}

class InvalidTokenError extends ContainerError {}
class InvalidFactoryError extends ContainerError {}
class DuplicateBindingError extends ContainerError {}
class UnresolvedTokenError extends ContainerError {}
class CircularDependencyError extends ContainerError {}

export {
  ContainerError,
  InvalidTokenError,
  InvalidFactoryError,
  DuplicateBindingError,
  UnresolvedTokenError,
  CircularDependencyError
};
