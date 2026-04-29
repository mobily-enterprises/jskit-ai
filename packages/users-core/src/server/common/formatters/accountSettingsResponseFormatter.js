import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  USER_SETTINGS_NOTIFICATION_KEYS,
  USER_SETTINGS_PREFERENCE_KEYS
} from "../../../shared/resources/userSettingsResource.js";
import { accountAvatarFormatter } from "./accountAvatarFormatter.js";
import { accountSecurityStatusFormatter } from "./accountSecurityStatusFormatter.js";

function resolveAuthProfileSettings(authService) {
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
