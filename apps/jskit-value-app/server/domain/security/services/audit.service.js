import { parsePositiveInteger } from "../../../lib/primitives/integers.js";

const SENSITIVE_METADATA_KEY_PATTERN = /(pass(word)?|token|secret|authorization|cookie|api[-_]?key|credential)/i;
const MAX_OBJECT_KEYS = 60;
const MAX_ARRAY_LENGTH = 40;
const MAX_METADATA_DEPTH = 6;

function normalizeString(value, maxLength = 0) {
  const normalized = String(value || "").trim();
  if (!maxLength || normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength);
}

function normalizeOutcome(value) {
  const normalized = normalizeString(value, 32).toLowerCase();
  if (normalized === "failure") {
    return "failure";
  }
  return "success";
}

function normalizeSurface(value) {
  const normalized = normalizeString(value, 64).toLowerCase();
  if (!normalized) {
    return "unknown";
  }

  return normalized;
}

function sanitizeMetadataValue(value, { key = "", depth = 0 } = {}) {
  if (SENSITIVE_METADATA_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }

  if (value == null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value;
  }

  if (typeof value === "string") {
    return normalizeString(value, 4000);
  }

  if (depth >= MAX_METADATA_DEPTH) {
    return "[TRUNCATED]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeMetadataValue(item, { depth: depth + 1 }));
  }

  if (typeof value === "object") {
    const output = {};
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    for (const [entryKey, entryValue] of entries) {
      const normalizedKey = normalizeString(entryKey, 120);
      if (!normalizedKey) {
        continue;
      }
      output[normalizedKey] = sanitizeMetadataValue(entryValue, {
        key: normalizedKey,
        depth: depth + 1
      });
    }

    if (Object.keys(value).length > entries.length) {
      output.__truncated = true;
    }

    return output;
  }

  return String(value);
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return sanitizeMetadataValue(metadata, { depth: 0 });
}

function normalizeAuditError(error) {
  const status = parsePositiveInteger(error?.status || error?.statusCode);
  return {
    name: normalizeString(error?.name, 120) || "Error",
    code: normalizeString(error?.code, 120),
    status: status || null
  };
}

function normalizeEvent(event) {
  return {
    createdAt: event?.createdAt || new Date(),
    action: normalizeString(event?.action, 128),
    outcome: normalizeOutcome(event?.outcome),
    actorUserId: parsePositiveInteger(event?.actorUserId),
    actorEmail: normalizeString(event?.actorEmail, 320).toLowerCase(),
    targetUserId: parsePositiveInteger(event?.targetUserId),
    workspaceId: parsePositiveInteger(event?.workspaceId),
    surface: normalizeSurface(event?.surface),
    requestId: normalizeString(event?.requestId, 128),
    method: normalizeString(event?.method, 16).toUpperCase(),
    path: normalizeString(event?.path, 2048),
    ipAddress: normalizeString(event?.ipAddress, 64),
    userAgent: normalizeString(event?.userAgent, 1024),
    metadata: sanitizeMetadata(event?.metadata)
  };
}

function recordAuditMetric(observabilityService, event) {
  if (!observabilityService || typeof observabilityService.recordSecurityAuditEvent !== "function") {
    return;
  }

  observabilityService.recordSecurityAuditEvent({
    action: event?.action,
    outcome: event?.outcome,
    surface: event?.surface
  });
}

function createService({ auditEventsRepository, observabilityService }) {
  if (!auditEventsRepository || typeof auditEventsRepository.insert !== "function") {
    throw new Error("auditEventsRepository is required.");
  }

  async function record(event) {
    const normalized = normalizeEvent(event);
    if (!normalized.action) {
      throw new Error("Audit event action is required.");
    }

    const result = await auditEventsRepository.insert(normalized);
    recordAuditMetric(observabilityService, normalized);
    return result;
  }

  async function recordSafe(event, logger) {
    try {
      return await record(event);
    } catch (error) {
      if (logger && typeof logger.warn === "function") {
        logger.warn(
          {
            action: normalizeString(event?.action, 128),
            requestId: normalizeString(event?.requestId, 128),
            auditError: normalizeAuditError(error)
          },
          "security.audit.record_failed"
        );
      }

      return null;
    }
  }

  return {
    record,
    recordSafe
  };
}

const __testables = {
  SENSITIVE_METADATA_KEY_PATTERN,
  normalizeString,
  normalizeOutcome,
  normalizeSurface,
  sanitizeMetadataValue,
  sanitizeMetadata,
  normalizeAuditError,
  normalizeEvent
};

export { createService, __testables };
