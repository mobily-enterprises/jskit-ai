import { normalizePositiveInteger } from "../../shared/support/normalize.js";

function parsePositiveInteger(value) {
  return normalizePositiveInteger(value, {
    fallback: null
  });
}

function normalizeNullablePositiveInteger(value) {
  return parsePositiveInteger(value);
}

export { parsePositiveInteger, normalizeNullablePositiveInteger };
