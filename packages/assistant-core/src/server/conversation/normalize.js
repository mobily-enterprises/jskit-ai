import { createHash } from "node:crypto";

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** SHA-256 of the value's JSON text, used for stable configuration identities. */
export function jsonHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
