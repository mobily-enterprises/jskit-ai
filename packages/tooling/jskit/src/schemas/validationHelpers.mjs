export function createCliError(message, { showUsage = false, exitCode = 1 } = {}) {
  const error = new Error(String(message || "Command failed."));
  error.showUsage = Boolean(showUsage);
  error.exitCode = Number.isInteger(exitCode) ? exitCode : 1;
  return error;
}

export function ensureObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createCliError(`${label} must be an object.`);
  }
  return value;
}

export function ensureRecord(value, label) {
  if (!value) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw createCliError(`${label} must be an object map.`);
  }
  return value;
}

export function ensurePackId(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw createCliError(`${label} is invalid: ${value}`);
  }
  return normalized;
}

export function ensurePackageId(value, label) {
  const normalized = String(value || "").trim();
  const npmNamePattern = /^(?:@[a-z0-9-._~]+\/)?[a-z0-9-._~]+$/;
  if (!npmNamePattern.test(normalized)) {
    throw createCliError(`${label} is invalid: ${value}`);
  }
  return normalized;
}

export function normalizeRelativePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.includes("..")) {
    throw createCliError(`Invalid relative path in descriptor: ${value}`);
  }
  return normalized;
}
