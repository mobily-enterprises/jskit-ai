import { createHash } from "node:crypto";

// Unlike the kernel's normalizeText, only null and undefined become blank:
// 0 and false keep their text, as native protocol fields require.
export function normalizeNullableText(value) {
  return String(value ?? "").trim();
}

/** SHA-256 of the value's JSON text, used for stable configuration identities. */
export function jsonHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Whether a value is an object literal or a null-prototype record, not an array or a class instance. */
export function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
