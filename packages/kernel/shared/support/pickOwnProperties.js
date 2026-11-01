import { isRecord } from "./normalize.js";

function pickOwnProperties(source, keys) {
  if (!isRecord(source)) {
    throw new TypeError("pickOwnProperties requires a plain object source.");
  }

  const patch = {};

  for (const key of keys) {
    if (Object.hasOwn(source, key)) {
      patch[key] = source[key];
    }
  }

  return patch;
}

export { pickOwnProperties };
