export const ENTITLEMENTS_ERROR_CODES = {
  VALIDATION_FAILED: "ENTITLEMENTS_VALIDATION_FAILED",
  ENTITLEMENT_NOT_CONFIGURED: "ENTITLEMENT_NOT_CONFIGURED",
  CONTRACT_VIOLATION: "ENTITLEMENTS_CONTRACT_VIOLATION"
};

export class EntitlementsError extends Error {
  constructor(message, options = {}) {
    const normalizedMessage = String(message || "Entitlements operation failed.").trim() || "Entitlements operation failed.";
    super(normalizedMessage, options.cause ? { cause: options.cause } : undefined);

    this.name = "EntitlementsError";
    this.code = String(options.code || ENTITLEMENTS_ERROR_CODES.CONTRACT_VIOLATION);
    this.statusCode = Number.isInteger(Number(options.statusCode)) ? Number(options.statusCode) : 500;
    this.details = options.details && typeof options.details === "object" ? options.details : {};
  }
}

export class EntitlementsValidationError extends EntitlementsError {
  constructor(message, options = {}) {
    super(message || "Entitlements validation failed.", {
      ...options,
      code: ENTITLEMENTS_ERROR_CODES.VALIDATION_FAILED,
      statusCode: options.statusCode ?? 400
    });
    this.name = "EntitlementsValidationError";
  }
}

export class EntitlementNotConfiguredError extends EntitlementsError {
  constructor(message, options = {}) {
    super(message || "Entitlement definition is not configured.", {
      ...options,
      code: ENTITLEMENTS_ERROR_CODES.ENTITLEMENT_NOT_CONFIGURED,
      statusCode: options.statusCode ?? 409
    });
    this.name = "EntitlementNotConfiguredError";
  }
}

export function isEntitlementsError(error) {
  return error instanceof EntitlementsError;
}
