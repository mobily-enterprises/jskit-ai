const SERVER_SIMULATION_KINDS = ["app_error", "type_error", "range_error", "async_rejection"];

function createConsoleErrorPayloadNormalizer({ parsePositiveInteger } = {}) {
  const parsePositive =
    typeof parsePositiveInteger === "function"
      ? parsePositiveInteger
      : (value) => {
          const parsed = Number(value);
          if (!Number.isInteger(parsed) || parsed < 1) {
            return null;
          }
          return parsed;
        };

  let simulationSequence = 0;

  function normalizeString(value, maxLength = 0) {
    const normalized = String(value || "").trim();
    if (!maxLength || normalized.length <= maxLength) {
      return normalized;
    }

    return normalized.slice(0, maxLength);
  }

  function normalizeStack(value, maxLength = 16000) {
    const normalized = String(value || "");
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return normalized.slice(0, maxLength);
  }

  function normalizeObject(value) {
    if (!value || typeof value !== "object") {
      return {};
    }

    if (Array.isArray(value)) {
      return {
        items: value.slice(0, 10)
      };
    }

    const clone = {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.keys(clone).length >= 30) {
        clone.__truncated = true;
        break;
      }

      const normalizedKey = normalizeString(key, 120);
      if (!normalizedKey) {
        continue;
      }

      if (item == null || typeof item === "boolean" || typeof item === "number") {
        clone[normalizedKey] = item;
        continue;
      }

      if (typeof item === "string") {
        clone[normalizedKey] = normalizeString(item, 800);
        continue;
      }

      if (Array.isArray(item)) {
        clone[normalizedKey] = item.slice(0, 10);
        continue;
      }

      if (typeof item === "object") {
        clone[normalizedKey] = "[object]";
      }
    }

    return clone;
  }

  function normalizeIsoDate(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString();
  }

  function normalizeBrowserPayload(payload, user) {
    const body = payload && typeof payload === "object" ? payload : {};
    const metadata = normalizeObject(body.metadata);

    return {
      occurredAt: normalizeIsoDate(body.occurredAt),
      source: normalizeString(body.source || "window.error", 48) || "window.error",
      errorName: normalizeString(body.errorName || body.name, 160),
      message: normalizeString(body.message || body.reason || "Unknown browser error", 2000),
      stack: normalizeStack(body.stack, 16000),
      url: normalizeString(body.url, 2048),
      path: normalizeString(body.path, 2048),
      surface: normalizeString(body.surface, 64),
      userAgent: normalizeString(body.userAgent, 1024),
      lineNumber: parsePositive(body.lineNumber || body.line),
      columnNumber: parsePositive(body.columnNumber || body.column),
      userId: parsePositive(user?.id),
      username: normalizeString(user?.displayName || user?.email || "", 160),
      metadata
    };
  }

  function normalizeServerPayload(payload) {
    const body = payload && typeof payload === "object" ? payload : {};

    return {
      requestId: normalizeString(body.requestId, 128),
      method: normalizeString(body.method, 16),
      path: normalizeString(body.path, 2048),
      statusCode: parsePositive(body.statusCode) || 500,
      errorName: normalizeString(body.errorName, 160),
      message: normalizeString(body.message || "Unknown server error", 2000),
      stack: normalizeStack(body.stack, 16000),
      userId: parsePositive(body.userId),
      username: normalizeString(body.username, 160),
      metadata: normalizeObject(body.metadata)
    };
  }

  function normalizeSimulationKind(value) {
    const normalized = normalizeString(value, 64).toLowerCase();
    if (!normalized || normalized === "auto") {
      const index = simulationSequence % SERVER_SIMULATION_KINDS.length;
      simulationSequence += 1;
      return SERVER_SIMULATION_KINDS[index];
    }

    if (!SERVER_SIMULATION_KINDS.includes(normalized)) {
      return "";
    }

    return normalized;
  }

  function createSimulationId() {
    return `sim-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }

  return {
    normalizeString,
    normalizeStack,
    normalizeObject,
    normalizeIsoDate,
    normalizeBrowserPayload,
    normalizeServerPayload,
    normalizeSimulationKind,
    createSimulationId,
    SERVER_SIMULATION_KINDS
  };
}

export { createConsoleErrorPayloadNormalizer, SERVER_SIMULATION_KINDS };
