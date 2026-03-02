import { createSettingsModel, PLATFORM_AVATAR_SETTINGS } from "@jskit-ai/workspace-console-core/settingsModel";

const APP_SETTINGS_MODEL_EXTENSION = Object.freeze({
  defaults: {
    locale: "en-US",
    currencyCode: "USD"
  },
  featureFlags: {
    securityAlertsAlwaysEnabled: true,
    allowPublicChatIdDiscoverabilityToggle: true
  }
});

const APP_SETTINGS_MODEL = createSettingsModel({
  avatar: PLATFORM_AVATAR_SETTINGS,
  modelExtension: APP_SETTINGS_MODEL_EXTENSION
});

const {
  SETTINGS_FEATURE_FLAGS,
  SETTINGS_DEFAULTS,
  SETTINGS_NOTIFICATIONS_DEFAULTS,
  SETTINGS_CHAT_DEFAULTS,
  SETTINGS_PREFERENCES_OPTIONS
} = APP_SETTINGS_MODEL;

export {
  APP_SETTINGS_MODEL,
  APP_SETTINGS_MODEL_EXTENSION,
  SETTINGS_FEATURE_FLAGS,
  SETTINGS_DEFAULTS,
  SETTINGS_NOTIFICATIONS_DEFAULTS,
  SETTINGS_CHAT_DEFAULTS,
  SETTINGS_PREFERENCES_OPTIONS
};
