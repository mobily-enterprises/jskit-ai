import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { DEFAULT_USER_SETTINGS } from "../../../shared/settings.js";
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
    preferences: {
      theme: settings.theme,
      locale: settings.locale,
      timeZone: settings.timeZone,
      dateFormat: settings.dateFormat,
      numberFormat: settings.numberFormat,
      currencyCode: settings.currencyCode,
      avatarSize: settings.avatarSize
    },
    notifications: {
      productUpdates: settings.productUpdates,
      accountActivity: settings.accountActivity,
      securityAlerts: settings.securityAlerts
    },
    chat: {
      ...(DEFAULT_USER_SETTINGS.chatSettings || {}),
      ...(settings.chatSettings && typeof settings.chatSettings === "object" ? settings.chatSettings : {})
    }
  };
}

export { accountSettingsResponseFormatter };
