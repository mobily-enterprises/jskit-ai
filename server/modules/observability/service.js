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
    typeof value.renderPrometheusMetrics === "function"
  );
}

function createService({ metricsRegistry, metricsEnabled = true, metricsBearerToken = "" } = {}) {
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

  return {
    isEnabled() {
      return enabled;
    },
    getMetricsPayload,
    observeHttpRequest,
    recordDbError,
    recordConsoleErrorIngestion,
    recordAuthFailure,
    recordSecurityAuditEvent
  };
}

const __testables = {
  normalizeBearerToken,
  parseAuthorizationBearerToken,
  isMetricsRegistry
};

export { createService, __testables };
