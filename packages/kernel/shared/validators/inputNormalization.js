import { isRecord } from "../support/normalize.js";

function normalizeObjectInput(value) {
  if (!isRecord(value)) {
    return {};
  }

  return {
    ...value
  };
}

export {
  normalizeObjectInput
};
