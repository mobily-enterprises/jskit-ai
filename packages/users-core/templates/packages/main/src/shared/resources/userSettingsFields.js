import { Type } from "typebox";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { DEFAULT_USER_SETTINGS } from "@jskit-ai/users-core/shared/settings";
import {
  USER_SETTINGS_SECTIONS,
  defineField,
  resetUserSettingsFields
} from "@jskit-ai/users-core/shared/resources/userSettingsFields";

function normalizePositiveInteger(value, fallback) {
  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    return numericValue;
  }
  return Number(fallback);
}

resetUserSettingsFields();

defineField({
  key: "theme",
  section: USER_SETTINGS_SECTIONS.PREFERENCES,
  dbColumn: "theme",
  required: true,
  inputSchema: Type.String({ minLength: 1, maxLength: 32 }),
  outputSchema: Type.String({ minLength: 1, maxLength: 32 }),
  normalizeInput: (value) => normalizeText(value),
  normalizeOutput: (value) => normalizeText(value) || DEFAULT_USER_SETTINGS.theme,
  resolveDefault: () => DEFAULT_USER_SETTINGS.theme
});

defineField({
  key: "locale",
  section: USER_SETTINGS_SECTIONS.PREFERENCES,
  dbColumn: "locale",
  required: true,
  inputSchema: Type.String({ minLength: 1, maxLength: 24 }),
  outputSchema: Type.String({ minLength: 1, maxLength: 24 }),
  normalizeInput: (value) => normalizeLowerText(value),
  normalizeOutput: (value) => normalizeLowerText(value) || DEFAULT_USER_SETTINGS.locale,
  resolveDefault: () => DEFAULT_USER_SETTINGS.locale
});

defineField({
  key: "timeZone",
  section: USER_SETTINGS_SECTIONS.PREFERENCES,
  dbColumn: "time_zone",
  required: true,
  inputSchema: Type.String({ minLength: 1, maxLength: 64 }),
  outputSchema: Type.String({ minLength: 1, maxLength: 64 }),
  normalizeInput: (value) => normalizeText(value),
  normalizeOutput: (value) => normalizeText(value) || DEFAULT_USER_SETTINGS.timeZone,
  resolveDefault: () => DEFAULT_USER_SETTINGS.timeZone
});

defineField({
  key: "dateFormat",
  section: USER_SETTINGS_SECTIONS.PREFERENCES,
  dbColumn: "date_format",
  required: true,
  inputSchema: Type.String({ minLength: 1, maxLength: 32 }),
  outputSchema: Type.String({ minLength: 1, maxLength: 32 }),
  normalizeInput: (value) => normalizeText(value),
  normalizeOutput: (value) => normalizeText(value) || DEFAULT_USER_SETTINGS.dateFormat,
  resolveDefault: () => DEFAULT_USER_SETTINGS.dateFormat
});

defineField({
  key: "numberFormat",
  section: USER_SETTINGS_SECTIONS.PREFERENCES,
  dbColumn: "number_format",
  required: true,
  inputSchema: Type.String({ minLength: 1, maxLength: 32 }),
  outputSchema: Type.String({ minLength: 1, maxLength: 32 }),
  normalizeInput: (value) => normalizeText(value),
  normalizeOutput: (value) => normalizeText(value) || DEFAULT_USER_SETTINGS.numberFormat,
  resolveDefault: () => DEFAULT_USER_SETTINGS.numberFormat
});

defineField({
  key: "currencyCode",
  section: USER_SETTINGS_SECTIONS.PREFERENCES,
  dbColumn: "currency_code",
  required: true,
  inputSchema: Type.String({ minLength: 3, maxLength: 3, pattern: "^[A-Za-z]{3}$" }),
  outputSchema: Type.String({ minLength: 3, maxLength: 3, pattern: "^[A-Z]{3}$" }),
  normalizeInput: (value) => normalizeText(value).toUpperCase(),
  normalizeOutput: (value) => normalizeText(value).toUpperCase() || DEFAULT_USER_SETTINGS.currencyCode,
  resolveDefault: () => DEFAULT_USER_SETTINGS.currencyCode
});

defineField({
  key: "avatarSize",
  section: USER_SETTINGS_SECTIONS.PREFERENCES,
  dbColumn: "avatar_size",
  required: true,
  inputSchema: Type.Integer({ minimum: 1 }),
  outputSchema: Type.Integer({ minimum: 1 }),
  normalizeInput: (value) => Number(value),
  normalizeOutput: (value) => normalizePositiveInteger(value, DEFAULT_USER_SETTINGS.avatarSize),
  resolveDefault: () => DEFAULT_USER_SETTINGS.avatarSize
});

defineField({
  key: "productUpdates",
  section: USER_SETTINGS_SECTIONS.NOTIFICATIONS,
  dbColumn: "notify_product_updates",
  required: true,
  inputSchema: Type.Boolean(),
  outputSchema: Type.Boolean(),
  normalizeInput: (value) => value,
  normalizeOutput: (value) => Boolean(value),
  resolveDefault: () => DEFAULT_USER_SETTINGS.productUpdates
});

defineField({
  key: "accountActivity",
  section: USER_SETTINGS_SECTIONS.NOTIFICATIONS,
  dbColumn: "notify_account_activity",
  required: true,
  inputSchema: Type.Boolean(),
  outputSchema: Type.Boolean(),
  normalizeInput: (value) => value,
  normalizeOutput: (value) => Boolean(value),
  resolveDefault: () => DEFAULT_USER_SETTINGS.accountActivity
});

defineField({
  key: "securityAlerts",
  section: USER_SETTINGS_SECTIONS.NOTIFICATIONS,
  dbColumn: "notify_security_alerts",
  required: true,
  inputSchema: Type.Boolean(),
  outputSchema: Type.Boolean(),
  normalizeInput: (value) => value,
  normalizeOutput: (value) => Boolean(value),
  resolveDefault: () => DEFAULT_USER_SETTINGS.securityAlerts
});
