import { normalizePositiveInteger } from "@jskit-ai/kernel/shared/support/normalize";

function toPositiveInteger(value, fallback = 0) {
  return normalizePositiveInteger(value, {
    fallback
  });
}

export { toPositiveInteger };
