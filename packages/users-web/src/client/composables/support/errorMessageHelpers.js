function normalizeErrorStatus(error) {
  if (error == null || typeof error !== "object") {
    return null;
  }

  const hasStatus = Object.prototype.hasOwnProperty.call(error, "status");
  const hasStatusCode = Object.prototype.hasOwnProperty.call(error, "statusCode");
  if (!hasStatus && !hasStatusCode) {
    return null;
  }

  const status = Number(hasStatus ? error.status : error.statusCode);
  return Number.isInteger(status) ? status : null;
}

function isGenericTransportMessage(error) {
  const normalizedMessage = String(error?.message || "").trim();
  if (!normalizedMessage) {
    return false;
  }

  const status = normalizeErrorStatus(error);
  if (status === 0) {
    return true;
  }

  return status != null && status >= 400 && normalizedMessage === `Request failed with status ${status}.`;
}

function toQueryErrorMessage(error, fallbackMessage = "", defaultMessage = "Request failed.") {
  if (!error) {
    return "";
  }

  const normalizedFallback = String(fallbackMessage || "").trim();
  const normalizedMessage = String(error?.message || "").trim();
  if (normalizedMessage && !isGenericTransportMessage(error)) {
    return normalizedMessage;
  }
  if (normalizedFallback) {
    return normalizedFallback;
  }
  if (normalizedMessage) {
    return normalizedMessage;
  }
  return String(defaultMessage || "Request failed.").trim();
}

function toUiErrorMessage(error, fallbackMessage = "", defaultMessage = "Request failed.") {
  const normalizedFallback = String(fallbackMessage || "").trim();
  if (normalizedFallback) {
    return normalizedFallback;
  }

  const normalizedMessage = String(error?.message || "").trim();
  if (normalizedMessage) {
    return normalizedMessage;
  }

  return String(defaultMessage || "Request failed.").trim();
}

export {
  toQueryErrorMessage,
  toUiErrorMessage
};
