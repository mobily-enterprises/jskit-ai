const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
const DEFAULT_HTTP_DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function normalizeMetricLabel(value, { fallback = "unknown", maxLength = 64 } = {}) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength).replace(/[^a-z0-9_.:-]/g, "_");
}

export { PROMETHEUS_CONTENT_TYPE, DEFAULT_HTTP_DURATION_BUCKETS_SECONDS, normalizeMetricLabel };
