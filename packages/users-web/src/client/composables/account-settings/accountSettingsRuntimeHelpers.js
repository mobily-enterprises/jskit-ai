import { ACCOUNT_SETTINGS_DEFAULTS } from "./accountSettingsRuntimeConstants.js";
import { isRecord, normalizeReturnToPath as normalizeSharedReturnToPath } from "@jskit-ai/kernel/shared/support";

function normalizeReturnToPath(value, { fallback = "/", accountSettingsPath = "/account", allowedOrigins = [] } = {}) {
  return normalizeSharedReturnToPath(value, {
    fallback,
    allowedOrigins,
    blockedPathnames: [accountSettingsPath],
    pickFirstArrayValue: true
  });
}

function normalizeSettingsPayload(value) {
  return isRecord(value) ? value : {};
}

function normalizeAvatarSize(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return ACCOUNT_SETTINGS_DEFAULTS.preferences.avatarSize;
  }

  const clamped = Math.min(128, Math.max(32, numeric));
  return clamped;
}

export {
  normalizeAvatarSize,
  normalizeReturnToPath,
  normalizeSettingsPayload
};
