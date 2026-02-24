import assert from "node:assert/strict";
import test from "node:test";
import {
  createSettingsModel,
  SETTINGS_DEFAULTS,
  SETTINGS_LIMITS,
  SETTINGS_CHAT_DEFAULTS
} from "../src/settingsModel.js";

test("createSettingsModel builds a reusable base model from avatar constraints", () => {
  const model = createSettingsModel({
    avatar: {
      minSize: 16,
      maxSize: 128,
      defaultSize: 64,
      sizeOptions: [16, 32, 64, 128]
    }
  });

  assert.equal(model.SETTINGS_LIMITS.avatarSizeMin, 16);
  assert.equal(model.SETTINGS_LIMITS.avatarSizeMax, 128);
  assert.equal(model.SETTINGS_DEFAULTS.avatarSize, 64);
  assert.deepEqual(model.SETTINGS_PREFERENCES_OPTIONS.avatarSize, [16, 32, 64, 128]);
  assert.equal(model.SETTINGS_FIELD_SPECS.notifications.securityAlerts.normalize(true), true);
});

test("createSettingsModel supports app-level extension patches", () => {
  const model = createSettingsModel({
    avatar: {
      minSize: 16,
      maxSize: 64,
      defaultSize: 32,
      sizeOptions: [16, 32, 64]
    },
    modelExtension: {
      defaults: {
        locale: "fr-FR"
      },
      notificationsDefaults: {
        productUpdates: false
      },
      featureFlags: {
        securityAlertsAlwaysEnabled: false
      },
      fieldSpecs: {
        notifications: {
          securityAlerts: {
            normalize(value) {
              return Boolean(value);
            }
          }
        }
      }
    }
  });

  assert.equal(model.SETTINGS_DEFAULTS.locale, "fr-FR");
  assert.equal(model.SETTINGS_NOTIFICATIONS_DEFAULTS.productUpdates, false);
  assert.equal(model.SETTINGS_FEATURE_FLAGS.securityAlertsAlwaysEnabled, false);
  assert.equal(model.SETTINGS_FIELD_SPECS.notifications.securityAlerts.normalize(false), false);
});

test("settingsModel exports a ready-to-use platform baseline", () => {
  assert.equal(SETTINGS_DEFAULTS.theme, "system");
  assert.equal(SETTINGS_DEFAULTS.avatarSize, 64);
  assert.equal(SETTINGS_LIMITS.avatarSizeMin, 32);
  assert.equal(SETTINGS_LIMITS.avatarSizeMax, 128);
  assert.equal(SETTINGS_CHAT_DEFAULTS.allowWorkspaceDms, true);
});
