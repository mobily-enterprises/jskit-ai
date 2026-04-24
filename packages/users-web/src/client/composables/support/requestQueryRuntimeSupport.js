import { computed, unref } from "vue";
import {
  resolveQueryParamDescriptors,
  resolveActiveQueryParamEntries,
  buildQueryParamEntriesToken
} from "./listQueryParamSupport.js";
import { appendRequestQueryEntriesToPath } from "./requestQueryPathSupport.js";

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

function createRequestQueryRuntime({
  requestQueryParams = null,
  context = null,
  sourceQueryKey = null,
  sourcePath = ""
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
  const requestPath = computed(() => {
    return appendRequestQueryEntriesToPath(
      unref(sourcePath),
      activeRequestQueryParamEntries.value
    );
  });

  return Object.freeze({
    requestQueryParamDescriptors,
    activeRequestQueryParamEntries,
    activeRequestQueryParamsToken,
    queryKey,
    requestPath
  });
}

export {
  createRequestQueryRuntime,
  resolveRequestQueryBaseKey,
  resolveRequestQueryContext
};
