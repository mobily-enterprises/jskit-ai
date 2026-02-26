const DIAGNOSTIC_LEVELS = Object.freeze({
  info: "info",
  warn: "warn",
  error: "error"
});

const VALID_LEVELS = new Set(Object.values(DIAGNOSTIC_LEVELS));

function normalizeCode(code) {
  const normalized = String(code || "").trim();
  if (!normalized) {
    throw new TypeError("diagnostic.code is required.");
  }
  return normalized;
}

function normalizeLevel(level) {
  if (level == null || level === "") {
    return DIAGNOSTIC_LEVELS.error;
  }
  const normalized = String(level).trim().toLowerCase();
  if (!VALID_LEVELS.has(normalized)) {
    throw new TypeError(`Unsupported diagnostic level \"${normalized}\".`);
  }
  return normalized;
}

function normalizeMessage(message) {
  const normalized = String(message || "").trim();
  if (!normalized) {
    throw new TypeError("diagnostic.message is required.");
  }
  return normalized;
}

function createDiagnostic(input = {}) {
  const output = {
    code: normalizeCode(input.code),
    level: normalizeLevel(input.level),
    message: normalizeMessage(input.message)
  };

  if (input.moduleId != null && String(input.moduleId || "").trim()) {
    output.moduleId = String(input.moduleId).trim();
  }

  if (Object.hasOwn(input, "details")) {
    output.details = input.details;
  }

  return Object.freeze(output);
}

function createDiagnosticsCollector(initial = []) {
  const entries = [];

  function add(diagnostic) {
    const normalized = createDiagnostic(diagnostic);
    entries.push(normalized);
    return normalized;
  }

  function addMany(list) {
    for (const diagnostic of Array.isArray(list) ? list : []) {
      add(diagnostic);
    }
  }

  addMany(initial);

  return {
    add,
    addMany,
    hasErrors() {
      return entries.some((entry) => entry.level === DIAGNOSTIC_LEVELS.error);
    },
    toJSON() {
      return entries.slice();
    }
  };
}

function throwOnDiagnosticErrors(diagnostics, message = "Module framework diagnostics contain errors.") {
  const collector = diagnostics && typeof diagnostics.toJSON === "function" ? diagnostics : null;
  if (!collector) {
    return;
  }

  if (!collector.hasErrors()) {
    return;
  }

  const error = new Error(message);
  error.code = "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR";
  error.diagnostics = collector.toJSON();
  throw error;
}

export { DIAGNOSTIC_LEVELS, createDiagnostic, createDiagnosticsCollector, throwOnDiagnosticErrors };
