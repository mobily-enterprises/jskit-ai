import { describe, expect, it } from "vitest";

import {
  APP_SETTINGS_MODEL,
  APP_SETTINGS_MODEL_EXTENSION,
  SETTINGS_CHAT_DEFAULTS,
  SETTINGS_DEFAULTS,
  SETTINGS_FEATURE_FLAGS,
  SETTINGS_NOTIFICATIONS_DEFAULTS,
  SETTINGS_PREFERENCES_OPTIONS
} from "../../src/modules/settings/settingsCatalog.js";

describe("settings catalog", () => {
  it("exposes app-specific defaults from the model extension", () => {
    expect(SETTINGS_DEFAULTS.locale).toBe("en-US");
    expect(SETTINGS_DEFAULTS.currencyCode).toBe("USD");

    expect(APP_SETTINGS_MODEL_EXTENSION.defaults).toMatchObject({
      locale: "en-US",
      currencyCode: "USD"
    });
  });

  it("keeps app feature flags and derived settings artifacts available", () => {
    expect(SETTINGS_FEATURE_FLAGS.securityAlertsAlwaysEnabled).toBe(true);
    expect(SETTINGS_FEATURE_FLAGS.allowPublicChatIdDiscoverabilityToggle).toBe(true);

    expect(SETTINGS_NOTIFICATIONS_DEFAULTS.securityAlerts).toBe(true);
    expect(typeof SETTINGS_CHAT_DEFAULTS.discoverableByPublicChatId).toBe("boolean");
    expect(Array.isArray(SETTINGS_PREFERENCES_OPTIONS.theme)).toBe(true);
    expect(APP_SETTINGS_MODEL.SETTINGS_FIELD_SPECS).toBeTruthy();
  });
});
