import { normalizePositiveInteger } from "../../shared/support/normalize.js";

function parsePositiveInteger(value) {
  return normalizePositiveInteger(value, {
    fallback: null
  });
}

export { parsePositiveInteger };
