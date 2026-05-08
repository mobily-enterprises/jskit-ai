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

export {
  hasResolvedQueryData,
  mergeQueryMeta
};
