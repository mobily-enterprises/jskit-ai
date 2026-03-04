export class AppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = options.code || "APP_ERROR";
    this.details = options.details;
    this.headers = options.headers || {};
  }
}

export class DomainError extends AppError {
  constructor(status, message, options = {}) {
    super(status, message, {
      ...options,
      code: options.code || "domain_error"
    });
    this.name = "DomainError";
  }
}

export class DomainValidationError extends DomainError {
  constructor(details, options = {}) {
    super(422, options.message || "Domain validation failed.", {
      ...options,
      code: options.code || "domain_validation_failed",
      details
    });
    this.name = "DomainValidationError";
  }
}

export class ConflictError extends DomainError {
  constructor(message = "Conflict.", options = {}) {
    super(409, message, {
      ...options,
      code: options.code || "conflict"
    });
    this.name = "ConflictError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Not found.", options = {}) {
    super(404, message, {
      ...options,
      code: options.code || "not_found"
    });
    this.name = "NotFoundError";
  }
}

export function isAppError(error) {
  return error instanceof AppError;
}

export function isDomainError(error) {
  return error instanceof DomainError;
}

export function createValidationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}
