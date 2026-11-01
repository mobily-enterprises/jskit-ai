import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// How a user profile's username, avatar key and avatar version are stored:
// the resource's setters and the profiles repository both normalize with these.
const USERNAME_MAX_LENGTH = 120;

function normalizeUsername(value) {
  const normalized = normalizeLowerText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX_LENGTH);

  return normalized || "";
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeText(value);
}

function normalizeNullableVersion(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value);
}

export { USERNAME_MAX_LENGTH, normalizeNullableString, normalizeNullableVersion, normalizeUsername };
