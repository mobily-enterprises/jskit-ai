class DatabaseRuntimeError extends Error {
  constructor(message, details = {}) {
    super(String(message || "Database runtime error."));
    this.name = this.constructor.name;
    this.details = details && typeof details === "object" ? { ...details } : {};
  }
}

class TransactionManagerError extends DatabaseRuntimeError {}
class RepositoryError extends DatabaseRuntimeError {}

export { DatabaseRuntimeError, TransactionManagerError, RepositoryError };
