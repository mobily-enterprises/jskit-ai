import { unref } from "vue";

function hasResolvedQueryData({ query = null, data = null } = {}) {
  const querySucceeded = Boolean(unref(query?.isSuccess));
  const hasDataPayload = unref(data) != null;

  return querySucceeded || hasDataPayload;
}

function mergeQueryMeta(queryOptions = null, meta = {}) {
  const sourceOptions =
    queryOptions && typeof queryOptions === "object" && !Array.isArray(queryOptions) ? queryOptions : {};
  const sourceMeta =
    sourceOptions.meta && typeof sourceOptions.meta === "object" && !Array.isArray(sourceOptions.meta)
      ? sourceOptions.meta
      : {};
  const sourceJskitMeta =
    sourceMeta.jskit && typeof sourceMeta.jskit === "object" && !Array.isArray(sourceMeta.jskit)
      ? sourceMeta.jskit
      : {};
  const nextJskitMeta =
    meta.jskit && typeof meta.jskit === "object" && !Array.isArray(meta.jskit)
      ? meta.jskit
      : {};

  return {
    ...sourceOptions,
    meta: {
      ...sourceMeta,
      ...meta,
      jskit: {
        ...sourceJskitMeta,
        ...nextJskitMeta
      }
    }
  };
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function firstNormalizedText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function firstNonNegativeFiniteNumber(...values) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      return Math.max(0, numberValue);
    }
  }
  return null;
}

function normalizePlainObject(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeRequestRecoveryInput(requestRecovery = null) {
  if (typeof requestRecovery === "string") {
    return {
      label: requestRecovery
    };
  }
  return normalizePlainObject(requestRecovery);
}

function normalizeRequestRecoveryMethod(value = "") {
  return normalizeText(value).toUpperCase();
}

function isRequestRecoveryMetaDisabled(sourceJskitMeta = {}, sourceMeta = {}) {
  return Boolean(
    sourceJskitMeta.requestRecovery === false ||
      sourceMeta.jskitRequestRecovery === false ||
      sourceMeta.requestRecovery === false
  );
}

function hasUsableMetaValue(source = {}, key = "") {
  return Object.hasOwn(source, key) && source[key] !== undefined && source[key] !== null && source[key] !== "";
}

function buildRequestRecoveryMeta(requestRecovery = null, defaults = {}) {
  if (requestRecovery === false) {
    return {
      jskit: {
        requestRecovery: false
      }
    };
  }

  const fallback = normalizePlainObject(defaults);
  const source = normalizeRequestRecoveryInput(requestRecovery);
  if (source.requestRecovery === false || source.enabled === false) {
    return {
      jskit: {
        requestRecovery: false
      }
    };
  }

  const label = firstNormalizedText(
    source.requestRecoveryLabel,
    source.label,
    fallback.requestRecoveryLabel,
    fallback.label
  );
  const recoverySource = firstNormalizedText(
    source.requestRecoverySource,
    source.source,
    fallback.requestRecoverySource,
    fallback.source
  );
  const dedupeKey = firstNormalizedText(
    source.requestRecoveryDedupeKey,
    source.dedupeKey,
    fallback.requestRecoveryDedupeKey,
    fallback.dedupeKey
  );
  const method = normalizeRequestRecoveryMethod(
    firstNormalizedText(
      source.requestRecoveryMethod,
      source.method,
      fallback.requestRecoveryMethod,
      fallback.method
    )
  );
  const dedupeWindowMs = firstNonNegativeFiniteNumber(
    source.requestRecoveryDedupeWindowMs,
    source.dedupeWindowMs,
    fallback.requestRecoveryDedupeWindowMs,
    fallback.dedupeWindowMs
  );

  const jskit = {};
  if (label) {
    jskit.requestRecoveryLabel = label;
  }
  if (recoverySource) {
    jskit.requestRecoverySource = recoverySource;
  }
  if (dedupeKey) {
    jskit.requestRecoveryDedupeKey = dedupeKey;
  }
  if (method) {
    jskit.requestRecoveryMethod = method;
  }
  if (dedupeWindowMs !== null) {
    jskit.requestRecoveryDedupeWindowMs = dedupeWindowMs;
  }

  return Object.keys(jskit).length > 0 ? { jskit } : {};
}

function hasRequestRecoveryMetaValue(sourceJskitMeta = {}, sourceMeta = {}, key = "") {
  const suffix = String(key || "").trim();
  if (!suffix) {
    return false;
  }

  const jskitKey = `requestRecovery${suffix}`;
  const legacyJskitKey = `jskitRequestRecovery${suffix}`;
  const legacyKey = `requestRecovery${suffix}`;

  return Boolean(
    hasUsableMetaValue(sourceJskitMeta, jskitKey) ||
      hasUsableMetaValue(sourceMeta, legacyJskitKey) ||
      hasUsableMetaValue(sourceMeta, legacyKey)
  );
}

function resolveRequestRecoveryDefaults(queryOptions = null, defaults = {}) {
  const sourceOptions = normalizePlainObject(queryOptions);
  const sourceMeta = normalizePlainObject(sourceOptions.meta);
  const sourceJskitMeta = normalizePlainObject(sourceMeta.jskit);
  const fallback = normalizePlainObject(defaults);
  if (isRequestRecoveryMetaDisabled(sourceJskitMeta, sourceMeta)) {
    return {};
  }

  const hasExplicitLabel = hasRequestRecoveryMetaValue(sourceJskitMeta, sourceMeta, "Label");
  const hasExplicitSource = hasRequestRecoveryMetaValue(sourceJskitMeta, sourceMeta, "Source");
  const hasExplicitDedupeKey = hasRequestRecoveryMetaValue(sourceJskitMeta, sourceMeta, "DedupeKey");
  const hasExplicitDedupeWindowMs = hasRequestRecoveryMetaValue(sourceJskitMeta, sourceMeta, "DedupeWindowMs");
  const hasExplicitMethod = hasRequestRecoveryMetaValue(sourceJskitMeta, sourceMeta, "Method");

  return {
    ...fallback,
    requestRecoveryLabel: hasExplicitLabel ? "" : fallback.requestRecoveryLabel,
    label: hasExplicitLabel ? "" : fallback.label,
    requestRecoverySource: hasExplicitSource ? "" : fallback.requestRecoverySource,
    source: hasExplicitSource ? "" : fallback.source,
    requestRecoveryDedupeKey: hasExplicitDedupeKey ? "" : fallback.requestRecoveryDedupeKey,
    dedupeKey: hasExplicitDedupeKey ? "" : fallback.dedupeKey,
    requestRecoveryDedupeWindowMs: hasExplicitDedupeWindowMs ? "" : fallback.requestRecoveryDedupeWindowMs,
    dedupeWindowMs: hasExplicitDedupeWindowMs ? "" : fallback.dedupeWindowMs,
    requestRecoveryMethod: hasExplicitMethod ? "" : fallback.requestRecoveryMethod,
    method: hasExplicitMethod ? "" : fallback.method
  };
}

function mergeRequestRecoveryQueryMeta(queryOptions = null, requestRecovery = null, defaults = {}) {
  const sourceOptions = normalizePlainObject(queryOptions);
  const effectiveDefaults =
    requestRecovery == null
      ? resolveRequestRecoveryDefaults(sourceOptions, defaults)
      : normalizePlainObject(defaults);
  const meta = buildRequestRecoveryMeta(requestRecovery, effectiveDefaults);
  if (Object.keys(meta).length < 1) {
    return sourceOptions;
  }
  return mergeQueryMeta(sourceOptions, meta);
}

export {
  buildRequestRecoveryMeta,
  hasResolvedQueryData,
  mergeQueryMeta,
  mergeRequestRecoveryQueryMeta
};
