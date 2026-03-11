import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { DEFAULT_USER_SETTINGS } from "../../../shared/settings.js";
import { accountAvatarFormatter } from "./accountAvatarFormatter.js";
import { accountSecurityStatusFormatter } from "./accountSecurityStatusFormatter.js";

function resolveAuthProfileContract(authService) {
  if (!authService || typeof authService.getSettingsProfileAuthInfo !== "function") {
    return {
      emailManagedBy: "auth",
      emailChangeFlow: "auth"
    };
  }

  const contract = authService.getSettingsProfileAuthInfo();
  return {
    emailManagedBy: normalizeLowerText(contract?.emailManagedBy) || "auth",
    emailChangeFlow: normalizeLowerText(contract?.emailChangeFlow) || "auth"
  };
}

function accountSettingsResponseFormatter({ profile, settings, securityStatus, authService }) {
  const contract = resolveAuthProfileContract(authService);

  return {
    profile: {
      displayName: normalizeText(profile?.displayName),
      email: normalizeLowerText(profile?.email),
      emailManagedBy: contract.emailManagedBy,
      emailChangeFlow: contract.emailChangeFlow,
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
