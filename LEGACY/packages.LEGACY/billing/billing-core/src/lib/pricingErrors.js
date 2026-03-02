function createDefaultError(status, message, options = {}) {
  const error = new Error(String(message || "Request failed."));
  error.name = "AppError";
  error.status = Number(status) || 500;
  error.statusCode = error.status;
  error.code = options.code || "APP_ERROR";
  error.details = options.details;
  error.headers = options.headers || {};
  return error;
}

export { createDefaultError };
