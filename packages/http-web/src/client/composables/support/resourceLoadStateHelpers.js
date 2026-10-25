import { unref } from "vue";
import { hasValue, isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function hasResolvedQueryData({ query = null, data = null } = {}) {
  const querySucceeded = Boolean(unref(query?.isSuccess));
  const hasDataPayload = unref(data) != null;

  return querySucceeded || hasDataPayload;
}

function mergeQueryMeta(queryOptions = null, meta = {}) {
  const sourceOptions = isRecord(queryOptions) ? queryOptions : {};
  const sourceMeta = isRecord(sourceOptions.meta) ? sourceOptions.meta : {};

  return {
    ...sourceOptions,
    meta: {
      ...sourceMeta,
      ...meta,
      jskit: {
        ...(isRecord(sourceMeta.jskit) ? sourceMeta.jskit : {}),
        ...(isRecord(meta.jskit) ? meta.jskit : {})
      }
    }
  };
}

// Each requestRecovery option and the query meta key shell-web's request
// recovery reads for it.
const REQUEST_RECOVERY_META_KEYS = Object.freeze({
  label: "requestRecoveryLabel",
  source: "requestRecoverySource",
  dedupeKey: "requestRecoveryDedupeKey",
  method: "requestRecoveryMethod",
  dedupeWindowMs: "requestRecoveryDedupeWindowMs"
});
const DISABLED_REQUEST_RECOVERY_META = Object.freeze({
  jskit: Object.freeze({ requestRecovery: false })
});

function normalizeRequestRecoveryInput(requestRecovery = null) {
  if (typeof requestRecovery === "string") {
    return { label: requestRecovery };
  }
  const source = isRecord(requestRecovery) ? requestRecovery : {};
  for (const key of Object.keys(source)) {
    if (key !== "enabled" && !Object.hasOwn(REQUEST_RECOVERY_META_KEYS, key)) {
      throw new TypeError(
        `requestRecovery.${key} is not supported; use ${Object.keys(REQUEST_RECOVERY_META_KEYS).join(", ")} or enabled.`
      );
    }
  }
  return source;
}

function normalizeRequestRecoveryValue(name, value) {
  if (name === "dedupeWindowMs") {
    const numberValue = value == null || value === "" ? Number.NaN : Number(value);
    return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
  }
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  return name === "method" ? text.toUpperCase() : text;
}

// requestRecovery is `false`, a label string, or an object of the short option
// names above (plus `enabled: false`); missing values come from `defaults`.
function buildRequestRecoveryMeta(requestRecovery = null, defaults = {}) {
  if (requestRecovery === false) {
    return DISABLED_REQUEST_RECOVERY_META;
  }
  const source = normalizeRequestRecoveryInput(requestRecovery);
  if (source.enabled === false) {
    return DISABLED_REQUEST_RECOVERY_META;
  }

  const fallback = isRecord(defaults) ? defaults : {};
  const jskit = {};
  for (const [name, metaKey] of Object.entries(REQUEST_RECOVERY_META_KEYS)) {
    const value = normalizeRequestRecoveryValue(name, source[name]) ??
      normalizeRequestRecoveryValue(name, fallback[name]);
    if (value !== null) {
      jskit[metaKey] = value;
    }
  }
  return Object.keys(jskit).length > 0 ? { jskit } : {};
}

function mergeRequestRecoveryQueryMeta(queryOptions = null, requestRecovery = null, defaults = {}) {
  const sourceOptions = isRecord(queryOptions) ? queryOptions : {};
  let meta;
  if (requestRecovery == null) {
    const presetMeta = isRecord(sourceOptions.meta?.jskit) ? sourceOptions.meta.jskit : {};
    if (presetMeta.requestRecovery === false) {
      return sourceOptions;
    }
    // Composable defaults never replace a hint the query options already set.
    const fallback = isRecord(defaults) ? defaults : {};
    const unsetDefaults = {};
    for (const [name, metaKey] of Object.entries(REQUEST_RECOVERY_META_KEYS)) {
      if (!hasValue(presetMeta[metaKey])) {
        unsetDefaults[name] = fallback[name];
      }
    }
    meta = buildRequestRecoveryMeta(null, unsetDefaults);
  } else {
    meta = buildRequestRecoveryMeta(requestRecovery, defaults);
  }
  return Object.keys(meta).length > 0 ? mergeQueryMeta(sourceOptions, meta) : sourceOptions;
}

export {
  buildRequestRecoveryMeta,
  hasResolvedQueryData,
  mergeQueryMeta,
  mergeRequestRecoveryQueryMeta
};
