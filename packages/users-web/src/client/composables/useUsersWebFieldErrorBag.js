import { reactive } from "vue";

function normalizeKeys(keys) {
  return Array.isArray(keys)
    ? keys.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

function useUsersWebFieldErrorBag(keys = []) {
  const normalizedKeys = normalizeKeys(keys);
  const hasFixedKeys = normalizedKeys.length > 0;
  const errors = reactive(
    Object.fromEntries(normalizedKeys.map((key) => [key, ""]))
  );

  function clear() {
    const keysToClear = hasFixedKeys ? normalizedKeys : Object.keys(errors);
    for (const key of keysToClear) {
      errors[key] = "";
    }
  }

  function apply(source = {}) {
    const fieldErrorMap = source && typeof source === "object" ? source : {};
    if (hasFixedKeys) {
      for (const key of normalizedKeys) {
        errors[key] = String(fieldErrorMap[key] || "");
      }
      return;
    }

    clear();
    for (const [field, message] of Object.entries(fieldErrorMap)) {
      const key = String(field || "").trim();
      if (!key) {
        continue;
      }
      errors[key] = String(message || "");
    }
  }

  function set(field, message) {
    const key = String(field || "").trim();
    if (!key) {
      return;
    }
    if (hasFixedKeys && !(key in errors)) {
      return;
    }
    errors[key] = String(message || "");
  }

  return Object.freeze({
    errors,
    clear,
    apply,
    set
  });
}

export { useUsersWebFieldErrorBag };
