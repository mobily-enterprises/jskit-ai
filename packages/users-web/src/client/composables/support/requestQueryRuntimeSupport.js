import { computed, unref } from "vue";
import {
  buildJsonApiFieldsetsToken,
  normalizeJsonApiFieldsets
} from "@jskit-ai/kernel/shared/support/jsonApiFieldsets";
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

function resolveRequestFieldsets(requestFieldsets = null, context = {}) {
  const source = typeof requestFieldsets === "function"
    ? requestFieldsets(context)
    : unref(requestFieldsets);
  return normalizeJsonApiFieldsets(source);
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

function buildRequestQueryObject(entries = [], { fieldsets = null } = {}) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const query = {};

  for (const entry of sourceEntries) {
    appendRequestQueryValue(query, entry?.key, entry?.values);
  }

  const normalizedFieldsets = normalizeJsonApiFieldsets(fieldsets);
  return Object.freeze({
    ...query,
    ...(Object.keys(normalizedFieldsets).length > 0
      ? { fields: normalizedFieldsets }
      : {})
  });
}

function createRequestQueryRuntime({
  requestQueryParams = null,
  requestFieldsets = null,
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
  const activeRequestFieldsets = computed(() => {
    return resolveRequestFieldsets(
      requestFieldsets,
      resolveRequestQueryContext(context)
    );
  });
  const activeRequestFieldsetsToken = computed(() => {
    return buildJsonApiFieldsetsToken(activeRequestFieldsets.value);
  });
  const queryKeyParts = computed(() => {
    const parts = [];
    if (activeRequestQueryParamsToken.value) {
      parts.push("__request_query__", activeRequestQueryParamsToken.value);
    }
    if (activeRequestFieldsetsToken.value) {
      parts.push("__request_fieldsets__", activeRequestFieldsetsToken.value);
    }
    return Object.freeze(parts);
  });
  const queryKey = computed(() => {
    if (queryKeyParts.value.length < 1) {
      return unref(sourceQueryKey);
    }

    return [
      ...resolveRequestQueryBaseKey(sourceQueryKey),
      ...queryKeyParts.value
    ];
  });
  const requestQuery = computed(() => {
    const query = buildRequestQueryObject(activeRequestQueryParamEntries.value, {
      fieldsets: activeRequestFieldsets.value
    });
    if (Object.keys(query).length < 1) {
      return null;
    }

    return query;
  });

  return Object.freeze({
    requestQueryParamDescriptors,
    activeRequestQueryParamEntries,
    activeRequestQueryParamsToken,
    activeRequestFieldsets,
    activeRequestFieldsetsToken,
    queryKeyParts,
    queryKey,
    requestQuery
  });
}

export {
  buildRequestQueryObject,
  createRequestQueryRuntime
};
