import { isRef, unref } from "vue";
import {
  normalizeBoolean,
  normalizeText,
  normalizeUniqueTextList
} from "@jskit-ai/kernel/shared/support/normalize";
import { asPlainObject } from "./scopeHelpers.js";

const QUERY_PARAM_BINDING_TYPE_TEXT = "text";
const QUERY_PARAM_BINDING_TYPE_BOOLEAN = "boolean";
const QUERY_PARAM_BINDING_TYPE_NUMBER = "number";
const QUERY_PARAM_BINDING_TYPE_ARRAY = "array";
const QUERY_PARAM_BINDING_TYPE_DATE = "date";

function normalizeListSyncToRouteConfig(syncToRoute = false, { defaultSearchParam = "q" } = {}) {
  const source = syncToRoute === true ? {} : asPlainObject(syncToRoute);
  const requested = syncToRoute === true || Object.keys(source).length > 0;
  const queryParamBlacklist = Object.freeze(normalizeUniqueTextList(source.queryParamBlacklist));
  if (!requested || source.enabled === false) {
    return Object.freeze({
      enabled: false,
      mode: "replace",
      syncSearch: false,
      syncQueryParams: false,
      hydrateFromRoute: false,
      searchParam: normalizeText(defaultSearchParam) || "q",
      queryParamBlacklist
    });
  }

  const mode = normalizeText(source.mode).toLowerCase() === "push" ? "push" : "replace";
  const searchParam = normalizeText(source.searchParam) || normalizeText(defaultSearchParam) || "q";

  return Object.freeze({
    enabled: true,
    mode,
    syncSearch: source.search !== false,
    syncQueryParams: source.queryParams !== false,
    hydrateFromRoute: source.hydrateFromRoute !== false,
    searchParam,
    queryParamBlacklist
  });
}

function normalizeQueryParamKey(value) {
  return normalizeText(value);
}

function normalizeQueryParamValues(value) {
  const list = Array.isArray(value) ? value : [value];
  const normalizedValues = [];

  for (const entry of list) {
    const resolvedEntry = unref(entry);
    if (resolvedEntry == null) {
      continue;
    }

    if (typeof resolvedEntry === "boolean") {
      if (resolvedEntry) {
        normalizedValues.push("1");
      }
      continue;
    }

    if (typeof resolvedEntry === "number") {
      if (Number.isFinite(resolvedEntry)) {
        normalizedValues.push(String(resolvedEntry));
      }
      continue;
    }

    if (resolvedEntry instanceof Date) {
      if (!Number.isNaN(resolvedEntry.getTime())) {
        normalizedValues.push(resolvedEntry.toISOString());
      }
      continue;
    }

    const normalizedText = normalizeText(resolvedEntry);
    if (normalizedText) {
      normalizedValues.push(normalizedText);
    }
  }

  return normalizedValues;
}

function resolveQueryParamsInput(queryParams, context = {}) {
  if (typeof queryParams === "function") {
    return asPlainObject(queryParams(context));
  }
  return asPlainObject(unref(queryParams));
}

function resolveQueryParamBindingType(value) {
  if (Array.isArray(value)) {
    return QUERY_PARAM_BINDING_TYPE_ARRAY;
  }
  if (typeof value === "boolean") {
    return QUERY_PARAM_BINDING_TYPE_BOOLEAN;
  }
  if (typeof value === "number") {
    return QUERY_PARAM_BINDING_TYPE_NUMBER;
  }
  if (value instanceof Date) {
    return QUERY_PARAM_BINDING_TYPE_DATE;
  }

  return QUERY_PARAM_BINDING_TYPE_TEXT;
}

function resolveArrayQueryParamItemType(values = []) {
  const list = Array.isArray(values) ? values : [];
  for (const entry of list) {
    if (entry == null) {
      continue;
    }

    if (typeof entry === "boolean") {
      return QUERY_PARAM_BINDING_TYPE_BOOLEAN;
    }
    if (typeof entry === "number") {
      return QUERY_PARAM_BINDING_TYPE_NUMBER;
    }
    if (entry instanceof Date) {
      return QUERY_PARAM_BINDING_TYPE_DATE;
    }

    return QUERY_PARAM_BINDING_TYPE_TEXT;
  }

  return QUERY_PARAM_BINDING_TYPE_TEXT;
}

function createWritableQueryParamBinding({
  source = {},
  rawKey = "",
  rawValue = null,
  key = ""
} = {}) {
  const valueSourceIsRef = isRef(rawValue);
  const read = valueSourceIsRef
    ? () => rawValue.value
    : () => source[rawKey];
  const write = valueSourceIsRef
    ? (nextValue) => {
        rawValue.value = nextValue;
      }
    : (nextValue) => {
        source[rawKey] = nextValue;
      };

  const currentValue = read();
  const valueType = resolveQueryParamBindingType(currentValue);
  return {
    key,
    valueType,
    arrayItemType: valueType === QUERY_PARAM_BINDING_TYPE_ARRAY
      ? resolveArrayQueryParamItemType(currentValue)
      : QUERY_PARAM_BINDING_TYPE_TEXT,
    get: read,
    set: write
  };
}

function resolveQueryParamDescriptors(queryParams, context = {}) {
  const source = resolveQueryParamsInput(queryParams, context);
  const descriptorsByKey = new Map();
  const canWriteToSource = typeof queryParams !== "function";

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeQueryParamKey(rawKey);
    if (!key) {
      continue;
    }

    const values = normalizeQueryParamValues(rawValue);
    const current = descriptorsByKey.get(key) || {
      key,
      values: [],
      binding: null
    };
    if (values.length > 0) {
      current.values.push(...values);
    }
    if (!current.binding && canWriteToSource) {
      current.binding = createWritableQueryParamBinding({
        source,
        rawKey,
        rawValue,
        key
      });
    }

    descriptorsByKey.set(key, current);
  }

  return [...descriptorsByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function resolveActiveQueryParamEntries(descriptors = []) {
  const source = Array.isArray(descriptors) ? descriptors : [];
  return source
    .filter((descriptor) => Array.isArray(descriptor?.values) && descriptor.values.length > 0)
    .map((descriptor) => ({
      key: descriptor.key,
      values: [...descriptor.values]
    }));
}

function resolveWritableQueryParamBindings(descriptors = []) {
  const source = Array.isArray(descriptors) ? descriptors : [];
  return source
    .map((descriptor) => descriptor?.binding || null)
    .filter(Boolean);
}

function buildQueryParamEntriesToken(entries = []) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  if (normalizedEntries.length < 1) {
    return "";
  }

  return normalizedEntries
    .map((entry) => {
      const key = normalizeQueryParamKey(entry?.key);
      const values = Array.isArray(entry?.values)
        ? entry.values.map((value) => normalizeText(value)).filter(Boolean)
        : [];
      if (!key || values.length < 1) {
        return "";
      }
      return `${key}=${values.join(",")}`;
    })
    .filter(Boolean)
    .join("&");
}

function firstRouteQueryValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function normalizeRouteQueryValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function parseRouteBooleanValue(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  if (value === null || value === "") {
    return true;
  }

  try {
    return normalizeBoolean(firstRouteQueryValue(value));
  } catch {
    return fallback;
  }
}

function parseRouteNumberValue(value, fallback = null) {
  if (value === undefined) {
    return null;
  }

  const normalized = normalizeText(firstRouteQueryValue(value));
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function parseRouteDateValue(value, fallback = null) {
  if (value === undefined) {
    return null;
  }

  const normalized = normalizeText(firstRouteQueryValue(value));
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed;
}

function parseRouteQueryItemValue(value, itemType = QUERY_PARAM_BINDING_TYPE_TEXT, fallback = null) {
  if (itemType === QUERY_PARAM_BINDING_TYPE_BOOLEAN) {
    try {
      return normalizeBoolean(value);
    } catch {
      return fallback;
    }
  }
  if (itemType === QUERY_PARAM_BINDING_TYPE_NUMBER) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }
  if (itemType === QUERY_PARAM_BINDING_TYPE_DATE) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
  }

  const normalized = normalizeText(value);
  return normalized || fallback;
}

function parseRouteBindingValue(binding, routeQueryValue) {
  const valueType = normalizeText(binding?.valueType).toLowerCase();
  if (valueType === QUERY_PARAM_BINDING_TYPE_BOOLEAN) {
    return parseRouteBooleanValue(routeQueryValue, false);
  }
  if (valueType === QUERY_PARAM_BINDING_TYPE_NUMBER) {
    const fallback = typeof binding?.get === "function" ? binding.get() : null;
    return parseRouteNumberValue(routeQueryValue, fallback);
  }
  if (valueType === QUERY_PARAM_BINDING_TYPE_DATE) {
    const fallback = typeof binding?.get === "function" ? binding.get() : null;
    return parseRouteDateValue(routeQueryValue, fallback);
  }
  if (valueType === QUERY_PARAM_BINDING_TYPE_ARRAY) {
    const itemType = normalizeText(binding?.arrayItemType).toLowerCase() || QUERY_PARAM_BINDING_TYPE_TEXT;
    return normalizeRouteQueryValues(routeQueryValue)
      .map((value) => parseRouteQueryItemValue(value, itemType, null))
      .filter((value) => value != null && !(typeof value === "string" && !value));
  }

  return normalizeText(firstRouteQueryValue(routeQueryValue));
}

function areQueryParamBindingItemsEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }

  return Object.is(left, right);
}

function areQueryParamBindingValuesEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return Object.is(left, right);
  }
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!areQueryParamBindingItemsEqual(left[index], right[index])) {
      return false;
    }
  }

  return true;
}

function buildRouteQueryCompareToken(query = {}) {
  const source = asPlainObject(query);
  const keys = Object.keys(source).sort();
  const parts = [];
  for (const key of keys) {
    const normalizedKey = normalizeQueryParamKey(key);
    if (!normalizedKey) {
      continue;
    }

    const normalizedValues = normalizeRouteQueryValues(source[key]);
    if (normalizedValues.length < 1) {
      continue;
    }

    parts.push(`${normalizedKey}=${normalizedValues.join(",")}`);
  }

  return parts.join("&");
}

function mergeManagedQueryParamKeyHistory(history = [], keys = []) {
  const merged = new Set();
  for (const key of Array.isArray(history) ? history : []) {
    const normalized = normalizeQueryParamKey(key);
    if (normalized) {
      merged.add(normalized);
    }
  }
  for (const key of Array.isArray(keys) ? keys : []) {
    const normalized = normalizeQueryParamKey(key);
    if (normalized) {
      merged.add(normalized);
    }
  }

  return [...merged].sort((left, right) => left.localeCompare(right));
}

function resolveRouteSyncManagedKeys({
  searchEnabled = false,
  searchParam = "q",
  syncSearch = false,
  syncQueryParams = false,
  declaredKeys = [],
  keyHistory = []
} = {}) {
  const managed = new Set();

  if (syncSearch === true && searchEnabled === true) {
    const normalizedSearchParam = normalizeQueryParamKey(searchParam);
    if (normalizedSearchParam) {
      managed.add(normalizedSearchParam);
    }
  }

  if (syncQueryParams === true) {
    for (const key of mergeManagedQueryParamKeyHistory(keyHistory, declaredKeys)) {
      managed.add(key);
    }
  }

  return [...managed].sort((left, right) => left.localeCompare(right));
}

export {
  normalizeListSyncToRouteConfig,
  resolveQueryParamDescriptors,
  resolveActiveQueryParamEntries,
  resolveWritableQueryParamBindings,
  buildQueryParamEntriesToken,
  parseRouteBindingValue,
  areQueryParamBindingValuesEqual,
  buildRouteQueryCompareToken,
  mergeManagedQueryParamKeyHistory,
  resolveRouteSyncManagedKeys
};
