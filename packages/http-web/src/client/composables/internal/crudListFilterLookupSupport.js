import { normalizeText, normalizeUniqueTextList } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveLookupItemLabel } from "../crud/crudLookupFieldLabelSupport.js";
import { asPlainObject } from "../support/scopeHelpers.js";

function normalizeLookupQueryKeyPrefix(value = []) {
  const source = Array.isArray(value) ? value : [];
  return Object.freeze(
    source
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  );
}

function normalizeLookupLabelResolverMap(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const normalized = {};

  for (const [key, entry] of Object.entries(source)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey || typeof entry !== "function") {
      continue;
    }

    normalized[normalizedKey] = entry;
  }

  return Object.freeze(normalized);
}

function normalizeLookupRequestQueryParamsMap(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const normalized = {};

  for (const [key, entry] of Object.entries(source)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) {
      continue;
    }
    if (entry == null) {
      continue;
    }
    if (typeof entry === "function") {
      normalized[normalizedKey] = entry;
      continue;
    }
    if (typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    normalized[normalizedKey] = asPlainObject(entry);
  }

  return Object.freeze(normalized);
}

function resolveLookupSelectedValues(filter = {}, rawValue = undefined) {
  if (filter?.type === "recordIdMany") {
    return normalizeUniqueTextList(rawValue, {
      acceptSingle: true
    });
  }

  const normalizedValue = normalizeText(rawValue);
  return normalizedValue ? Object.freeze([normalizedValue]) : Object.freeze([]);
}

function createLookupOptionFromItem(item = {}, filter = {}, labelResolver = null) {
  const sourceRecord = asPlainObject(item);
  const valueKey = normalizeText(filter?.lookup?.valueKey) || "id";
  const labelKey = normalizeText(filter?.lookup?.labelKey);
  const value = normalizeText(sourceRecord[valueKey]);
  if (!value) {
    return null;
  }

  const customLabel = typeof labelResolver === "function"
    ? normalizeText(labelResolver(sourceRecord, filter))
    : "";
  const fallbackLabel = resolveLookupItemLabel(sourceRecord, labelKey) || value;

  return Object.freeze({
    value,
    label: customLabel || String(fallbackLabel || value),
    record: sourceRecord
  });
}

function createLookupOptionsFromItems(items = [], filter = {}, labelResolver = null) {
  const optionMap = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const option = createLookupOptionFromItem(item, filter, labelResolver);
    if (!option || optionMap.has(option.value)) {
      continue;
    }

    optionMap.set(option.value, option);
  }

  return Object.freeze([...optionMap.values()]);
}

function mergeSelectedLookupOptions(options = [], selectedValues = [], cachedOptions = new Map()) {
  const optionMap = new Map(
    (Array.isArray(options) ? options : []).map((option) => [normalizeText(option?.value), option])
  );
  const normalizedCache = cachedOptions instanceof Map ? cachedOptions : new Map();

  for (const value of Array.isArray(selectedValues) ? selectedValues : []) {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue || optionMap.has(normalizedValue)) {
      continue;
    }

    const cachedOption = normalizedCache.get(normalizedValue);
    if (cachedOption) {
      optionMap.set(normalizedValue, cachedOption);
    }
  }

  return Object.freeze(
    [...optionMap.values()].sort((left, right) => {
      return String(left?.label || "").localeCompare(String(right?.label || ""));
    })
  );
}

function resolveLookupOptionLabel(options = [], cachedOptions = new Map(), value = "", fallback = "Option") {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return normalizeText(fallback) || "Option";
  }

  const matchingOption = (Array.isArray(options) ? options : [])
    .find((option) => normalizeText(option?.value) === normalizedValue);
  if (matchingOption?.label) {
    return String(matchingOption.label);
  }

  const normalizedCache = cachedOptions instanceof Map ? cachedOptions : new Map();
  const cachedOption = normalizedCache.get(normalizedValue);
  if (cachedOption?.label) {
    return String(cachedOption.label);
  }

  const normalizedFallback = normalizeText(fallback) || "Option";
  return `${normalizedFallback} ${normalizedValue}`;
}

export {
  normalizeLookupQueryKeyPrefix,
  normalizeLookupLabelResolverMap,
  normalizeLookupRequestQueryParamsMap,
  resolveLookupSelectedValues,
  createLookupOptionsFromItems,
  mergeSelectedLookupOptions,
  resolveLookupOptionLabel
};
