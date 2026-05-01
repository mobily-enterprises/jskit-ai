import { computed, unref } from "vue";
import {
  resolveQueryParamDescriptors,
  resolveActiveQueryParamEntries,
  buildQueryParamEntriesToken
} from "./listQueryParamSupport.js";

function resolveRequestQueryContext(context = null) {
  const source = unref(context);
  return source && typeof source === "object" && !Array.isArray(source) ? source : {};
}

function resolveRequestQueryBaseKey(sourceQueryKey = null) {
  const source = unref(sourceQueryKey);
  if (Array.isArray(source)) {
    return [...source];
  }
  if (source == null) {
    return [];
  }
  return [source];
}

function appendRequestQueryValue(target = {}, key = "", values = []) {
  const normalizedKey = String(key || "").trim();
  const normalizedValues = (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (!normalizedKey || normalizedValues.length < 1) {
    return;
  }

  const currentValue = target[normalizedKey];
  if (currentValue === undefined) {
    target[normalizedKey] = normalizedValues.length === 1 ? normalizedValues[0] : [...normalizedValues];
    return;
  }

  const currentValues = Array.isArray(currentValue) ? [...currentValue] : [currentValue];
  target[normalizedKey] = [...currentValues, ...normalizedValues];
}

function buildRequestQueryObject(entries = []) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const query = {};

  for (const entry of sourceEntries) {
    appendRequestQueryValue(query, entry?.key, entry?.values);
  }

  return Object.freeze(query);
}

function createRequestQueryRuntime({
  requestQueryParams = null,
  context = null,
  sourceQueryKey = null
} = {}) {
  const requestQueryParamDescriptors = computed(() => {
    return resolveQueryParamDescriptors(requestQueryParams, resolveRequestQueryContext(context));
  });
  const activeRequestQueryParamEntries = computed(() => {
    return resolveActiveQueryParamEntries(requestQueryParamDescriptors.value);
  });
  const activeRequestQueryParamsToken = computed(() => {
    return buildQueryParamEntriesToken(activeRequestQueryParamEntries.value);
  });
  const queryKey = computed(() => {
    if (!activeRequestQueryParamsToken.value) {
      return unref(sourceQueryKey);
    }

    const next = resolveRequestQueryBaseKey(sourceQueryKey);
    next.push("__request_query__", activeRequestQueryParamsToken.value);
    return next;
  });
  const requestQuery = computed(() => {
    if (activeRequestQueryParamEntries.value.length < 1) {
      return null;
    }

    return buildRequestQueryObject(activeRequestQueryParamEntries.value);
  });

  return Object.freeze({
    requestQueryParamDescriptors,
    activeRequestQueryParamEntries,
    activeRequestQueryParamsToken,
    queryKey,
    requestQuery
  });
}

export {
  appendRequestQueryValue,
  buildRequestQueryObject,
  createRequestQueryRuntime,
  resolveRequestQueryBaseKey,
  resolveRequestQueryContext
};
