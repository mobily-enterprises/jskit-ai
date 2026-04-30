import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { DEFAULT_USER_SETTINGS } from "../../../shared/settings.js";

function serializeNullableDateTime(value) {
  if (value == null) {
    return null;
  }

  return toDatabaseDateTimeUtc(value);
}

function normalizePositiveInteger(value) {
  return Number(value);
}

const resource = Object.freeze({
  tableName: "user_settings",
  idProperty: "user_id",
  searchSchema: {
    id: { type: "id", actualField: "id" }
  },
  schema: {
    id: {
      type: "id",
      primary: true,
      required: true,
      search: true,
      storage: { column: "user_id" }
    },
    theme: {
      type: "string",
      required: true,
      max: 32,
      defaultTo: DEFAULT_USER_SETTINGS.theme,
      setter: (value) => normalizeText(value)
    },
    locale: {
      type: "string",
      required: true,
      max: 24,
      defaultTo: DEFAULT_USER_SETTINGS.locale,
      setter: (value) => normalizeLowerText(value)
    },
    timeZone: {
      type: "string",
      required: true,
      max: 64,
      defaultTo: DEFAULT_USER_SETTINGS.timeZone,
      storage: { column: "time_zone" },
      setter: (value) => normalizeText(value)
    },
    dateFormat: {
      type: "string",
      required: true,
      max: 32,
      defaultTo: DEFAULT_USER_SETTINGS.dateFormat,
      storage: { column: "date_format" },
      setter: (value) => normalizeText(value)
    },
    numberFormat: {
      type: "string",
      required: true,
      max: 32,
      defaultTo: DEFAULT_USER_SETTINGS.numberFormat,
      storage: { column: "number_format" },
      setter: (value) => normalizeText(value)
    },
    currencyCode: {
      type: "string",
      required: true,
      minLength: 3,
      maxLength: 3,
      defaultTo: DEFAULT_USER_SETTINGS.currencyCode,
      storage: { column: "currency_code" },
      setter: (value) => normalizeText(value).toUpperCase()
    },
    avatarSize: {
      type: "number",
      required: true,
      min: 1,
      defaultTo: DEFAULT_USER_SETTINGS.avatarSize,
      storage: { column: "avatar_size" },
      setter: (value) => normalizePositiveInteger(value)
    },
    passwordSignInEnabled: {
      type: "boolean",
      required: true,
      defaultTo: DEFAULT_USER_SETTINGS.passwordSignInEnabled,
      storage: { column: "password_sign_in_enabled" }
    },
    passwordSetupRequired: {
      type: "boolean",
      required: true,
      defaultTo: DEFAULT_USER_SETTINGS.passwordSetupRequired,
      storage: { column: "password_setup_required" }
    },
    productUpdates: {
      type: "boolean",
      required: true,
      defaultTo: DEFAULT_USER_SETTINGS.productUpdates,
      storage: { column: "notify_product_updates" }
    },
    accountActivity: {
      type: "boolean",
      required: true,
      defaultTo: DEFAULT_USER_SETTINGS.accountActivity,
      storage: { column: "notify_account_activity" }
    },
    securityAlerts: {
      type: "boolean",
      required: true,
      defaultTo: DEFAULT_USER_SETTINGS.securityAlerts,
      storage: { column: "notify_security_alerts" }
    },
    createdAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "created_at",
        serialize: serializeNullableDateTime
      }
    },
    updatedAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "updated_at",
        serialize: serializeNullableDateTime
      }
    }
  }
});

export { resource as userSettingsResource };
