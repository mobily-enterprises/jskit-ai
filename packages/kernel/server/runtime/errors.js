// The values a code's sentence needs ({ min: 8 }), so a client can show the code
// in the user's language; message stays the English text.
function normalizeErrorParams(params) {
  return params && typeof params === "object" && !Array.isArray(params) ? { ...params } : {};
}

export class AppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = options.code || "APP_ERROR";
    this.params = normalizeErrorParams(options.params);
    // A per-sentence code for errors that must keep a shared code callers branch on.
    if (options.messageCode) {
      this.messageCode = String(options.messageCode);
      this.messageParams = normalizeErrorParams(options.messageParams);
    }
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

// A field error is an English string or { code, params, message }. fieldErrors
// keeps the English strings; fieldErrorCodes carries the coded entries.
export function createValidationError(fieldErrors) {
  const messages = {};
  const fieldErrorCodes = {};
  for (const [field, entry] of Object.entries(fieldErrors || {})) {
    if (!entry || typeof entry !== "object") {
      messages[field] = entry;
      continue;
    }
    messages[field] = String(entry.message || "");
    if (entry.code) {
      fieldErrorCodes[field] = { code: String(entry.code), params: normalizeErrorParams(entry.params) };
    }
  }
  return new AppError(400, "Validation failed.", {
    code: "validation_failed",
    details: {
      fieldErrors: messages,
      ...(Object.keys(fieldErrorCodes).length ? { fieldErrorCodes } : {})
    }
  });
}
