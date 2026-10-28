const AVATAR_DEFAULT_SIZE = 64;

// Option titles are message keys; the runtime translates them.
const THEME_OPTIONS = Object.freeze([
  { titleKey: "jskit.users.accountSettings.preferences.theme.system", value: "system" },
  { titleKey: "jskit.users.accountSettings.preferences.theme.light", value: "light" },
  { titleKey: "jskit.users.accountSettings.preferences.theme.dark", value: "dark" }
]);

// The languages offered when the app configures none (config.languages).
const LOCALE_OPTIONS = Object.freeze([
  { titleKey: "jskit.users.accountSettings.preferences.locale.enUS", value: "en-US" },
  { titleKey: "jskit.users.accountSettings.preferences.locale.enGB", value: "en-GB" },
  { titleKey: "jskit.users.accountSettings.preferences.locale.itIT", value: "it-IT" },
  { titleKey: "jskit.users.accountSettings.preferences.locale.esES", value: "es-ES" }
]);

const DATE_FORMAT_OPTIONS = Object.freeze([
  { titleKey: "jskit.users.accountSettings.preferences.dateFormat.system", value: "system" },
  { titleKey: "jskit.users.accountSettings.preferences.dateFormat.mdy", value: "mdy" },
  { titleKey: "jskit.users.accountSettings.preferences.dateFormat.dmy", value: "dmy" },
  { titleKey: "jskit.users.accountSettings.preferences.dateFormat.ymd", value: "ymd" }
]);

const NUMBER_FORMAT_OPTIONS = Object.freeze([
  { titleKey: "jskit.users.accountSettings.preferences.numberFormat.system", value: "system" },
  { titleKey: "jskit.users.accountSettings.preferences.numberFormat.commaDot", value: "comma-dot" },
  { titleKey: "jskit.users.accountSettings.preferences.numberFormat.dotComma", value: "dot-comma" },
  { titleKey: "jskit.users.accountSettings.preferences.numberFormat.spaceComma", value: "space-comma" }
]);

const CURRENCY_OPTIONS = Object.freeze(["USD", "EUR", "GBP", "AUD", "JPY"]);

const TIME_ZONE_OPTIONS = Object.freeze([
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Rome",
  "Asia/Tokyo",
  "Australia/Sydney"
]);

const AVATAR_SIZE_OPTIONS = Object.freeze([32, 40, 48, 56, 64, 72, 80, 96, 112, 128]);

const ACCOUNT_SETTINGS_DEFAULTS = Object.freeze({
  preferences: {
    theme: "system",
    locale: "en-US",
    timeZone: "UTC",
    dateFormat: "system",
    numberFormat: "system",
    currencyCode: "USD",
    avatarSize: AVATAR_DEFAULT_SIZE
  },
  notifications: {
    productUpdates: true,
    accountActivity: true,
    securityAlerts: true
  }
});

export {
  ACCOUNT_SETTINGS_DEFAULTS,
  AVATAR_DEFAULT_SIZE,
  AVATAR_SIZE_OPTIONS,
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  LOCALE_OPTIONS,
  NUMBER_FORMAT_OPTIONS,
  THEME_OPTIONS,
  TIME_ZONE_OPTIONS
};
