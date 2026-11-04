import { toValue, unref } from "vue";

function resolveEnabledRef(value) {
  if (value === undefined) {
    return true;
  }

  return Boolean(toValue(value));
}

function resolveTextRef(value) {
  return String(unref(value) || "").trim();
}

export { resolveEnabledRef, resolveTextRef };
