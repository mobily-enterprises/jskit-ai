import { unref } from "vue";

function hasResolvedQueryData({ query = null, data = null } = {}) {
  const querySucceeded = Boolean(unref(query?.isSuccess));
  const hasDataPayload = unref(data) != null;

  return querySucceeded || hasDataPayload;
}

export { hasResolvedQueryData };
