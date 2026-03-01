function createHttpError(response, data = {}) {
  const payload = data && typeof data === "object" ? data : {};
  const error = new Error(payload.error || `Request failed with status ${response.status}.`);
  error.status = Number(response?.status || 0);
  error.fieldErrors = payload.fieldErrors || payload.details?.fieldErrors || null;
  error.details = payload.details || null;
  return error;
}

function createNetworkError(cause) {
  const error = new Error("Network request failed.");
  error.status = 0;
  error.fieldErrors = null;
  error.details = null;
  error.cause = cause;
  return error;
}

export { createHttpError, createNetworkError };
