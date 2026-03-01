const LOGGER_METHODS = ["debug", "info", "warn", "error"];

export const NOOP_LOGGER = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

export function validateLogger(logger) {
  const target = logger && typeof logger === "object" ? logger : null;
  const missingMethods = [];

  for (const methodName of LOGGER_METHODS) {
    if (!target || typeof target[methodName] !== "function") {
      missingMethods.push(methodName);
    }
  }

  return {
    valid: missingMethods.length < 1,
    missingMethods
  };
}

export function assertLogger(logger, options = {}) {
  const validation = validateLogger(logger);
  if (validation.valid) {
    return logger;
  }

  const name = String(options.name || "logger").trim() || "logger";
  throw new Error(`${name}.${validation.missingMethods[0]} must be a function.`);
}

export function resolveLogger(logger) {
  if (!logger) {
    return NOOP_LOGGER;
  }
  return assertLogger(logger);
}

export { LOGGER_METHODS };
