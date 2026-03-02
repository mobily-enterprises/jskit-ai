function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
  return isObjectRecord(object) && Object.hasOwn(object, key);
}

function createFieldErrorBag() {
  return {};
}

function addFieldError(bag, field, message) {
  if (!isObjectRecord(bag)) {
    return bag;
  }

  const fieldName = String(field || "").trim();
  if (!fieldName) {
    return bag;
  }

  bag[fieldName] = String(message || "Validation failed.");
  return bag;
}

function hasFieldErrors(bag) {
  return isObjectRecord(bag) && Object.keys(bag).length > 0;
}

function toValidationError(createError, bag, options = {}) {
  const status = Number(options.status) || 400;
  const message = String(options.message || "Validation failed.");
  const normalizedBag = isObjectRecord(bag) ? { ...bag } : {};

  if (typeof createError === "function") {
    return createError(status, message, {
      details: {
        fieldErrors: normalizedBag
      }
    });
  }

  const fallbackError = new Error(message);
  fallbackError.status = status;
  fallbackError.statusCode = status;
  fallbackError.details = {
    fieldErrors: normalizedBag
  };

  return fallbackError;
}

export {
  addFieldError,
  createFieldErrorBag,
  hasFieldErrors,
  hasOwn,
  isObjectRecord,
  toValidationError
};
