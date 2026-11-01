function asLogger(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function callLoggerMethod(logger, methodName, fallbackMethodName, args) {
  if (logger && typeof logger[methodName] === "function") {
    logger[methodName](...args);
    return;
  }

  if (typeof console[fallbackMethodName] === "function") {
    console[fallbackMethodName](...args);
  }
}

function createProviderLogger(loggerLike = null, { debugEnabled = false, debugMethod = "info" } = {}) {
  const logger = asLogger(loggerLike);
  const resolvedDebugMethod = String(debugMethod || "info").trim() || "info";

  function debug(...args) {
    if (debugEnabled !== true) {
      return;
    }
    callLoggerMethod(logger, resolvedDebugMethod, "info", args);
  }

  function info(...args) {
    callLoggerMethod(logger, "info", "info", args);
  }

  function warn(...args) {
    callLoggerMethod(logger, "warn", "warn", args);
  }

  function error(...args) {
    callLoggerMethod(logger, "error", "error", args);
  }

  return Object.freeze({ debug, info, warn, error });
}

export { createProviderLogger };
