import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  USER_SETTINGS_SECTIONS,
  userSettingsFields
} from "../../../shared/resources/userSettingsFields.js";
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

function formatUserSettingsSection(section, settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const formatted = {};

  for (const field of userSettingsFields) {
    if (field.section !== section) {
      continue;
    }
    const rawValue = Object.hasOwn(source, field.key)
      ? source[field.key]
      : field.resolveDefault({
          settings: source
        });
    formatted[field.key] = field.normalizeOutput(rawValue, {
      settings: source
    });
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
    preferences: formatUserSettingsSection(USER_SETTINGS_SECTIONS.PREFERENCES, settings),
    notifications: formatUserSettingsSection(USER_SETTINGS_SECTIONS.NOTIFICATIONS, settings)
  };
}

export { accountSettingsResponseFormatter };
