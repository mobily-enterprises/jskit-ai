import { AppError } from "../../lib/errors.js";
import { createMetricsRegistry, PROMETHEUS_CONTENT_TYPE } from "../../lib/observability/metrics.js";

function normalizeBearerToken(value) {
  return String(value || "").trim();
}

function parseAuthorizationBearerToken(value) {
  const headerValue = String(value || "").trim();
  if (!headerValue) {
    return "";
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return "";
  }

  return String(match[1] || "").trim();
}

function isMetricsRegistry(value) {
  return (
    value &&
    typeof value.observeHttpRequest === "function" &&
    typeof value.recordDbError === "function" &&
    typeof value.recordConsoleErrorIngestion === "function" &&
    typeof value.recordAuthFailure === "function" &&
    typeof value.recordSecurityAuditEvent === "function" &&
    typeof value.recordAiTurn === "function" &&
    typeof value.recordAiToolCall === "function" &&
    typeof value.renderPrometheusMetrics === "function"
  );
}

function normalizeCorrelationId(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function shouldRecordGuardrailEvent({ measure, value }) {
  const normalizedMeasure = normalizeCorrelationId(measure);
  if (normalizedMeasure !== "count") {
    return true;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0;
}

function normalizeGuardrailMeasurementValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function createService({ metricsRegistry, metricsEnabled = true, metricsBearerToken = "", logger = console } = {}) {
  const registry = isMetricsRegistry(metricsRegistry) ? metricsRegistry : createMetricsRegistry();
  const enabled = Boolean(metricsEnabled);
  const requiredBearerToken = normalizeBearerToken(metricsBearerToken);

  function ensureAuthorized(authorizationHeader) {
    if (!requiredBearerToken) {
      return;
    }

    const providedToken = parseAuthorizationBearerToken(authorizationHeader);
    if (providedToken !== requiredBearerToken) {
      throw new AppError(401, "Authentication required.");
    }
  }

  function getMetricsPayload({ authorizationHeader } = {}) {
    if (!enabled) {
      throw new AppError(404, "Not found.");
    }

    ensureAuthorized(authorizationHeader);

    return {
      contentType: String(registry.contentType || PROMETHEUS_CONTENT_TYPE),
      body: registry.renderPrometheusMetrics()
    };
  }

  function observeHttpRequest(payload) {
    registry.observeHttpRequest(payload || {});
  }

  function recordDbError(payload) {
    registry.recordDbError(payload || {});
  }

  function recordConsoleErrorIngestion(payload) {
    registry.recordConsoleErrorIngestion(payload || {});
  }

  function recordAuthFailure(payload) {
    registry.recordAuthFailure(payload || {});
  }

  function recordSecurityAuditEvent(payload) {
    registry.recordSecurityAuditEvent(payload || {});
  }

  function recordAiTurn(payload) {
    registry.recordAiTurn(payload || {});
  }

  function recordAiToolCall(payload) {
    registry.recordAiToolCall(payload || {});
  }

  function recordBillingGuardrail(payload) {
    const normalizedPayload = payload && typeof payload === "object" ? payload : {};
    const code = normalizedPayload.code;
    const measure = normalizedPayload.measure;
    const value = normalizedPayload.value;
    const normalizedValue = normalizeGuardrailMeasurementValue(value);

    if (!shouldRecordGuardrailEvent({ measure, value })) {
      return;
    }

    if (typeof registry.recordBillingGuardrailEvent === "function") {
      registry.recordBillingGuardrailEvent({
        code
      });
    } else {
      registry.recordDbError({
        code
      });
    }

    if (normalizedValue != null && typeof registry.recordBillingGuardrailMeasurement === "function") {
      registry.recordBillingGuardrailMeasurement({
        code,
        measure,
        value: normalizedValue
      });
    }

    if (logger && typeof logger.warn === "function") {
      logger.warn(
        {
          code: String(code || "").trim() || "UNKNOWN",
          operation_key: normalizeCorrelationId(normalizedPayload.operationKey),
          provider_event_id: normalizeCorrelationId(normalizedPayload.providerEventId),
          billable_entity_id: normalizePositiveInteger(normalizedPayload.billableEntityId),
          measure: normalizeCorrelationId(measure),
          value: normalizedValue
        },
        "billing.guardrail"
      );
    }
  }

  return {
    isEnabled() {
      return enabled;
    },
    getMetricsPayload,
    observeHttpRequest,
    recordDbError,
    recordConsoleErrorIngestion,
    recordAuthFailure,
    recordSecurityAuditEvent,
    recordAiTurn,
    recordAiToolCall,
    recordBillingGuardrail
  };
}

const __testables = {
  normalizeBearerToken,
  parseAuthorizationBearerToken,
  isMetricsRegistry,
  normalizeCorrelationId,
  normalizePositiveInteger,
  shouldRecordGuardrailEvent,
  normalizeGuardrailMeasurementValue
};

export { createService, __testables };
