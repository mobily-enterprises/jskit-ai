function normalizeScopeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function matchesScopePattern(scope, pattern) {
  if (!pattern) {
    return false;
  }

  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    if (!prefix) {
      return true;
    }
    return scope === prefix || scope.startsWith(`${prefix}.`);
  }

  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    if (!prefix) {
      return true;
    }
    return scope.startsWith(prefix);
  }

  return scope === pattern || scope.startsWith(`${pattern}.`);
}

function parseScopeRules(rawValue) {
  const input = String(rawValue || "").trim();
  if (!input) {
    return [];
  }

  return input
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const exclude = token.startsWith("-");
      const normalizedPattern = normalizeScopeToken(exclude ? token.slice(1) : token);
      if (!normalizedPattern) {
        return null;
      }

      return {
        exclude,
        pattern: normalizedPattern
      };
    })
    .filter(Boolean);
}

function createScopeDebugMatcher(rawValue) {
  const rules = parseScopeRules(rawValue);

  return function isScopeDebugEnabled(scope) {
    const normalizedScope = normalizeScopeToken(scope);
    if (!normalizedScope || rules.length < 1) {
      return false;
    }

    let enabled = false;
    for (const rule of rules) {
      if (!matchesScopePattern(normalizedScope, rule.pattern)) {
        continue;
      }
      enabled = !rule.exclude;
    }

    return enabled;
  };
}

function resolveMethod(logger, method) {
  if (!logger || typeof logger !== "object") {
    return null;
  }

  if (typeof logger[method] === "function") {
    return logger[method].bind(logger);
  }
  if (typeof logger.log === "function") {
    return logger.log.bind(logger);
  }

  return null;
}

function toScopePrefix(scope) {
  const normalizedScope = normalizeScopeToken(scope);
  if (!normalizedScope) {
    return "";
  }
  return `[${normalizedScope}]`;
}

function createScopedLogger({ logger = console, scope = "", isScopeDebugEnabled = () => false } = {}) {
  const normalizedScope = normalizeScopeToken(scope);
  const hasChildLogger = logger && typeof logger.child === "function";
  const scopedLogger = hasChildLogger && normalizedScope ? logger.child({ scope: normalizedScope }) : logger || console;
  const scopePrefix = hasChildLogger ? "" : toScopePrefix(normalizedScope);

  function write(level, args, { debugOnly = false } = {}) {
    if (debugOnly && !isScopeDebugEnabled(normalizedScope)) {
      return;
    }

    const method = resolveMethod(scopedLogger, level);
    if (!method) {
      return;
    }

    if (scopePrefix) {
      method(scopePrefix, ...args);
      return;
    }

    method(...args);
  }

  return Object.freeze({
    debug(...args) {
      write("debug", args, { debugOnly: true });
    },
    info(...args) {
      write("info", args);
    },
    warn(...args) {
      write("warn", args);
    },
    error(...args) {
      write("error", args);
    },
    child(bindings = {}) {
      if (hasChildLogger) {
        return createScopedLogger({
          logger: scopedLogger.child(bindings || {}),
          scope: normalizedScope,
          isScopeDebugEnabled
        });
      }
      return createScopedLogger({
        logger: scopedLogger,
        scope: normalizedScope,
        isScopeDebugEnabled
      });
    }
  });
}

const __testables = {
  normalizeScopeToken,
  matchesScopePattern,
  parseScopeRules,
  resolveMethod,
  toScopePrefix
};

export { createScopeDebugMatcher, createScopedLogger, __testables };
