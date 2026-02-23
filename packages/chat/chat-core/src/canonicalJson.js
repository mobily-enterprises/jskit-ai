import crypto from "node:crypto";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.constructor === Object;
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (isPlainObject(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      const next = value[key];
      if (next === undefined) {
        continue;
      }
      sorted[key] = sortValue(next);
    }
    return sorted;
  }

  return value;
}

function toCanonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function toSha256Hex(value) {
  const source = String(value || "");
  return crypto.createHash("sha256").update(source).digest("hex");
}

const __testables = {
  isPlainObject,
  sortValue
};

export { toCanonicalJson, toSha256Hex, __testables };
