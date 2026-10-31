import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  USER_SETTINGS_NOTIFICATION_KEYS,
  USER_SETTINGS_PREFERENCE_KEYS
} from "../../../shared/resources/userSettingsResource.js";
import { accountAvatarFormatter } from "./accountAvatarFormatter.js";
import { accountSecurityStatusFormatter } from "./accountSecurityStatusFormatter.js";

/** @param {import("@jskit-ai/auth-core/server/types").AuthService | undefined} authService */
function resolveAuthProfileSettings(authService) {
  // readable-check: allow method-probe - optional operation: getSettingsProfileAuthInfo is an optional auth.service operation
  if (!authService || typeof authService.getSettingsProfileAuthInfo !== "function") {
    return {
      emailManagedBy: "auth",
      emailChangeFlow: "auth"
    };
  }

  const authProfileSettings = authService.getSettingsProfileAuthInfo();
  return {
    emailManagedBy: normalizeLowerText(authProfileSettings?.emailManagedBy) || "auth",
    emailChangeFlow: normalizeLowerText(authProfileSettings?.emailChangeFlow) || "auth"
  };
}

function formatUserSettingsSection(fieldKeys, settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const formatted = {};

  for (const fieldKey of fieldKeys) {
    formatted[fieldKey] = source[fieldKey];
  }

  return formatted;
}

/**
 * @param {object} input
 * @param {object | null} input.profile
 * @param {object | null} input.settings
 * @param {object | null} input.securityStatus
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} [input.authService] The installed provider's `auth.service`; without one, email is managed by auth.
 */
function accountSettingsResponseFormatter({ profile, settings, securityStatus, authService }) {
  const authProfileSettings = resolveAuthProfileSettings(authService);

  return {
    profile: {
      displayName: normalizeText(profile?.displayName),
      email: normalizeLowerText(profile?.email),
      emailManagedBy: authProfileSettings.emailManagedBy,
      emailChangeFlow: authProfileSettings.emailChangeFlow,
      avatar: accountAvatarFormatter(profile, settings)
    },
    security: accountSecurityStatusFormatter(securityStatus),
    preferences: formatUserSettingsSection(USER_SETTINGS_PREFERENCE_KEYS, settings),
    notifications: formatUserSettingsSection(USER_SETTINGS_NOTIFICATION_KEYS, settings)
  };
}

export { accountSettingsResponseFormatter };
