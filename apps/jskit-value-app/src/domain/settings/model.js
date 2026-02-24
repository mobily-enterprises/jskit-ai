import { createSettingsModel, PLATFORM_AVATAR_SETTINGS } from "@jskit-ai/workspace-console-core/settingsModel";

const APP_SETTINGS_MODEL = createSettingsModel({
  avatar: PLATFORM_AVATAR_SETTINGS,
  modelExtension: {
    defaults: {
      locale: "en-US",
      currencyCode: "USD"
    },
    featureFlags: {
      securityAlertsAlwaysEnabled: true,
      allowPublicChatIdDiscoverabilityToggle: true
    }
  }
});

const {
  SETTINGS_DEFAULTS,
  SETTINGS_NOTIFICATIONS_DEFAULTS,
  SETTINGS_CHAT_DEFAULTS,
  SETTINGS_PREFERENCES_OPTIONS
} = APP_SETTINGS_MODEL;

export {
  APP_SETTINGS_MODEL,
  SETTINGS_DEFAULTS,
  SETTINGS_NOTIFICATIONS_DEFAULTS,
  SETTINGS_CHAT_DEFAULTS,
  SETTINGS_PREFERENCES_OPTIONS
};
