import { unref } from "vue";

function requireRecord(value, label = "value", owner = "Contract") {
  const resolved = unref(value);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new TypeError(`${owner} expects ${label} to be an object.`);
  }

  return resolved;
}

function requireBoolean(value, label = "value", owner = "Contract") {
  const resolved = unref(value);
  if (typeof resolved !== "boolean") {
    throw new TypeError(`${owner} expects ${label} to be a boolean.`);
  }

  return resolved;
}

export {
  requireRecord,
  requireBoolean
};
