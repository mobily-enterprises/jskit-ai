import { ACCOUNT_SETTINGS_DEFAULTS } from "./accountSettingsRuntimeConstants.js";
import {
  isRecord,
  normalizeReturnToPath as normalizeSharedReturnToPath,
  resolveAllowedOriginsFromPlacementContext
} from "@jskit-ai/kernel/shared/support";

function normalizeReturnToPath(value, { fallback = "/", accountSettingsPath = "/account", allowedOrigins = [] } = {}) {
  return normalizeSharedReturnToPath(value, {
    fallback,
    allowedOrigins,
    blockedPathnames: [accountSettingsPath],
    pickFirstArrayValue: true
  });
}

function resolveAllowedReturnToOrigins(contextValue = null) {
  return resolveAllowedOriginsFromPlacementContext(contextValue);
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
  resolveAllowedReturnToOrigins,
  normalizeAvatarSize,
  normalizeReturnToPath,
  normalizeSettingsPayload
};
