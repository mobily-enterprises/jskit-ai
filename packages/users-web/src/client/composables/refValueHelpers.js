import { unref } from "vue";

function resolveEnabledRef(value) {
  if (value === undefined) {
    return true;
  }

  return Boolean(unref(value));
}

function resolveTextRef(value) {
  return String(unref(value) || "").trim();
}

export { resolveEnabledRef, resolveTextRef };
