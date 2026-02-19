const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
const DEFAULT_HTTP_DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const MAX_LABEL_VALUE_LENGTH = 160;
const MAX_ROUTE_LABEL_LENGTH = 240;

function sanitizeLabelValue(value, { fallback = "unknown", maxLength = MAX_LABEL_VALUE_LENGTH } = {}) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return fallback;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength);
}

function escapePrometheusLabelValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatMetricLabels(labels) {
  const entries = Object.entries(labels || {});
  if (entries.length < 1) {
    return "";
  }

  const rendered = entries.map(([key, value]) => `${key}="${escapePrometheusLabelValue(value)}"`);
  return `{${rendered.join(",")}}`;
}

function formatMetricNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "0";
  }

  if (Number.isInteger(parsed)) {
    return String(parsed);
  }

  return String(Number(parsed.toPrecision(12)));
}

function stableLabelSet(labelNames, labels) {
  const labelSet = {};
  const input = labels && typeof labels === "object" ? labels : {};
  for (const labelName of labelNames) {
    labelSet[labelName] = sanitizeLabelValue(input[labelName]);
  }

  return labelSet;
}

function labelSetKey(labelNames, labels) {
  const labelSet = stableLabelSet(labelNames, labels);
  return JSON.stringify(labelSet);
}

function compareLabelSets(left, right) {
  return JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels));
}

class CounterMetric {
  constructor({ name, help, labelNames }) {
    this.name = String(name || "").trim();
    this.help = String(help || "").trim();
    this.labelNames = Array.isArray(labelNames) ? [...labelNames] : [];
    this.series = new Map();
  }

  increment(labels, value = 1) {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return;
    }

    const key = labelSetKey(this.labelNames, labels);
    const existing = this.series.get(key);
    if (existing) {
      existing.value += parsedValue;
      return;
    }

    this.series.set(key, {
      labels: stableLabelSet(this.labelNames, labels),
      value: parsedValue
    });
  }

  toLines() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    const entries = [...this.series.values()].sort(compareLabelSets);
    for (const entry of entries) {
      lines.push(`${this.name}${formatMetricLabels(entry.labels)} ${formatMetricNumber(entry.value)}`);
    }

    return lines;
  }
}

class HistogramMetric {
  constructor({ name, help, labelNames, buckets }) {
    this.name = String(name || "").trim();
    this.help = String(help || "").trim();
    this.labelNames = Array.isArray(labelNames) ? [...labelNames] : [];
    this.buckets = Array.isArray(buckets)
      ? [...new Set(buckets.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))].sort(
          (left, right) => left - right
        )
      : [...DEFAULT_HTTP_DURATION_BUCKETS_SECONDS];
    this.series = new Map();
  }

  observe(labels, value) {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      return;
    }

    const key = labelSetKey(this.labelNames, labels);
    let entry = this.series.get(key);
    if (!entry) {
      entry = {
        labels: stableLabelSet(this.labelNames, labels),
        count: 0,
        sum: 0,
        bucketCounts: this.buckets.map(() => 0)
      };
      this.series.set(key, entry);
    }

    entry.count += 1;
    entry.sum += parsedValue;
    for (let index = 0; index < this.buckets.length; index += 1) {
      if (parsedValue <= this.buckets[index]) {
        entry.bucketCounts[index] += 1;
      }
    }
  }

  toLines() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    const entries = [...this.series.values()].sort(compareLabelSets);

    for (const entry of entries) {
      for (let index = 0; index < this.buckets.length; index += 1) {
        const labels = {
          ...entry.labels,
          le: formatMetricNumber(this.buckets[index])
        };
        lines.push(`${this.name}_bucket${formatMetricLabels(labels)} ${formatMetricNumber(entry.bucketCounts[index])}`);
      }

      lines.push(`${this.name}_bucket${formatMetricLabels({ ...entry.labels, le: "+Inf" })} ${formatMetricNumber(entry.count)}`);
      lines.push(`${this.name}_sum${formatMetricLabels(entry.labels)} ${formatMetricNumber(entry.sum)}`);
      lines.push(`${this.name}_count${formatMetricLabels(entry.labels)} ${formatMetricNumber(entry.count)}`);
    }

    return lines;
  }
}

function resolveStatusClass(statusCode) {
  const parsed = Number(statusCode);
  if (!Number.isFinite(parsed)) {
    return "other";
  }

  if (parsed >= 100 && parsed < 200) {
    return "1xx";
  }
  if (parsed >= 200 && parsed < 300) {
    return "2xx";
  }
  if (parsed >= 300 && parsed < 400) {
    return "3xx";
  }
  if (parsed >= 400 && parsed < 500) {
    return "4xx";
  }
  if (parsed >= 500 && parsed < 600) {
    return "5xx";
  }

  return "other";
}

function normalizeMethodLabel(value) {
  return sanitizeLabelValue(value, {
    fallback: "UNKNOWN",
    maxLength: 16
  }).toUpperCase();
}

function normalizeRouteLabel(value) {
  const normalized = sanitizeLabelValue(value, {
    fallback: "unmatched",
    maxLength: MAX_ROUTE_LABEL_LENGTH
  });
  if (normalized === "unmatched") {
    return normalized;
  }

  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeSurfaceLabel(value) {
  return sanitizeLabelValue(value, {
    fallback: "unknown",
    maxLength: 32
  }).toLowerCase();
}

function normalizeOutcomeLabel(value) {
  const normalized = sanitizeLabelValue(value, {
    fallback: "unknown",
    maxLength: 24
  }).toLowerCase();

  if (normalized === "success" || normalized === "failure") {
    return normalized;
  }

  return "unknown";
}

function normalizeErrorCodeLabel(value) {
  const normalized = sanitizeLabelValue(value, {
    fallback: "unknown",
    maxLength: 64
  }).toUpperCase();

  return normalized.replace(/[^A-Z0-9_.:-]/g, "_");
}

function normalizeActionLabel(value) {
  const normalized = sanitizeLabelValue(value, {
    fallback: "unknown",
    maxLength: 128
  }).toLowerCase();

  return normalized.replace(/[^a-z0-9_.:-]/g, "_");
}

function normalizeReasonLabel(value) {
  const normalized = sanitizeLabelValue(value, {
    fallback: "unknown",
    maxLength: 64
  }).toLowerCase();

  return normalized.replace(/[^a-z0-9_.:-]/g, "_");
}

function normalizeDurationSeconds(durationMs) {
  const parsedDurationMs = Number(durationMs);
  if (!Number.isFinite(parsedDurationMs) || parsedDurationMs < 0) {
    return null;
  }

  return parsedDurationMs / 1000;
}

function createMetricsRegistry({ httpDurationBuckets = DEFAULT_HTTP_DURATION_BUCKETS_SECONDS } = {}) {
  const metrics = {
    httpRequestsTotal: new CounterMetric({
      name: "app_http_requests_total",
      help: "Total HTTP requests grouped by method, route, surface, and status class.",
      labelNames: ["method", "route", "surface", "status_class"]
    }),
    httpRequestDurationSeconds: new HistogramMetric({
      name: "app_http_request_duration_seconds",
      help: "HTTP request duration in seconds grouped by method, route, and surface.",
      labelNames: ["method", "route", "surface"],
      buckets: httpDurationBuckets
    }),
    http4xxTotal: new CounterMetric({
      name: "app_http_4xx_total",
      help: "Total 4xx HTTP responses grouped by route and surface.",
      labelNames: ["route", "surface"]
    }),
    http5xxTotal: new CounterMetric({
      name: "app_http_5xx_total",
      help: "Total 5xx HTTP responses grouped by route and surface.",
      labelNames: ["route", "surface"]
    }),
    dbErrorsTotal: new CounterMetric({
      name: "app_db_errors_total",
      help: "Total database-related errors grouped by normalized error code.",
      labelNames: ["code"]
    }),
    consoleErrorIngestionTotal: new CounterMetric({
      name: "app_console_error_ingestion_total",
      help: "Total browser/server error ingestion attempts grouped by source and outcome.",
      labelNames: ["source", "outcome"]
    }),
    authFailuresTotal: new CounterMetric({
      name: "app_auth_failures_total",
      help: "Total authentication and authorization failures grouped by reason and surface.",
      labelNames: ["reason", "surface"]
    }),
    securityAuditEventsTotal: new CounterMetric({
      name: "app_security_audit_events_total",
      help: "Total persisted security audit events grouped by action, outcome, and surface.",
      labelNames: ["action", "outcome", "surface"]
    })
  };

  function observeHttpRequest({ method, route, surface, statusCode, durationMs }) {
    const methodLabel = normalizeMethodLabel(method);
    const routeLabel = normalizeRouteLabel(route);
    const surfaceLabel = normalizeSurfaceLabel(surface);
    const statusClass = resolveStatusClass(statusCode);

    metrics.httpRequestsTotal.increment({
      method: methodLabel,
      route: routeLabel,
      surface: surfaceLabel,
      status_class: statusClass
    });

    const durationSeconds = normalizeDurationSeconds(durationMs);
    if (durationSeconds != null) {
      metrics.httpRequestDurationSeconds.observe(
        {
          method: methodLabel,
          route: routeLabel,
          surface: surfaceLabel
        },
        durationSeconds
      );
    }

    if (statusClass === "4xx") {
      metrics.http4xxTotal.increment({
        route: routeLabel,
        surface: surfaceLabel
      });
    } else if (statusClass === "5xx") {
      metrics.http5xxTotal.increment({
        route: routeLabel,
        surface: surfaceLabel
      });
    }
  }

  function recordDbError({ code }) {
    metrics.dbErrorsTotal.increment({
      code: normalizeErrorCodeLabel(code)
    });
  }

  function recordConsoleErrorIngestion({ source, outcome }) {
    metrics.consoleErrorIngestionTotal.increment({
      source: sanitizeLabelValue(source, {
        fallback: "unknown",
        maxLength: 16
      }).toLowerCase(),
      outcome: normalizeOutcomeLabel(outcome)
    });
  }

  function recordAuthFailure({ reason, surface }) {
    metrics.authFailuresTotal.increment({
      reason: normalizeReasonLabel(reason),
      surface: normalizeSurfaceLabel(surface)
    });
  }

  function recordSecurityAuditEvent({ action, outcome, surface }) {
    metrics.securityAuditEventsTotal.increment({
      action: normalizeActionLabel(action),
      outcome: normalizeOutcomeLabel(outcome),
      surface: normalizeSurfaceLabel(surface)
    });
  }

  function renderPrometheusMetrics() {
    const blocks = [
      metrics.httpRequestsTotal.toLines(),
      metrics.httpRequestDurationSeconds.toLines(),
      metrics.http4xxTotal.toLines(),
      metrics.http5xxTotal.toLines(),
      metrics.dbErrorsTotal.toLines(),
      metrics.consoleErrorIngestionTotal.toLines(),
      metrics.authFailuresTotal.toLines(),
      metrics.securityAuditEventsTotal.toLines()
    ];

    return `${blocks.flat().join("\n")}\n`;
  }

  return {
    contentType: PROMETHEUS_CONTENT_TYPE,
    observeHttpRequest,
    recordDbError,
    recordConsoleErrorIngestion,
    recordAuthFailure,
    recordSecurityAuditEvent,
    renderPrometheusMetrics
  };
}

const __testables = {
  CounterMetric,
  HistogramMetric,
  sanitizeLabelValue,
  resolveStatusClass,
  normalizeMethodLabel,
  normalizeRouteLabel,
  normalizeSurfaceLabel,
  normalizeOutcomeLabel,
  normalizeErrorCodeLabel,
  normalizeActionLabel,
  normalizeReasonLabel,
  normalizeDurationSeconds,
  formatMetricLabels,
  formatMetricNumber
};

export { PROMETHEUS_CONTENT_TYPE, DEFAULT_HTTP_DURATION_BUCKETS_SECONDS, createMetricsRegistry, __testables };
