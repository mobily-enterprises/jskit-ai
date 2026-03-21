const AVATAR_ALLOWED_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_DEFAULT_SIZE = 64;

const THEME_OPTIONS = Object.freeze([
  { title: "System", value: "system" },
  { title: "Light", value: "light" },
  { title: "Dark", value: "dark" }
]);

const LOCALE_OPTIONS = Object.freeze([
  { title: "English (US)", value: "en-US" },
  { title: "English (UK)", value: "en-GB" },
  { title: "Italian", value: "it-IT" },
  { title: "Spanish", value: "es-ES" }
]);

const DATE_FORMAT_OPTIONS = Object.freeze([
  { title: "System", value: "system" },
  { title: "MM/DD/YYYY", value: "mdy" },
  { title: "DD/MM/YYYY", value: "dmy" },
  { title: "YYYY-MM-DD", value: "ymd" }
]);

const NUMBER_FORMAT_OPTIONS = Object.freeze([
  { title: "System", value: "system" },
  { title: "1,234.56", value: "comma-dot" },
  { title: "1.234,56", value: "dot-comma" },
  { title: "1 234,56", value: "space-comma" }
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
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DEFAULT_SIZE,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_SIZE_OPTIONS,
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  LOCALE_OPTIONS,
  NUMBER_FORMAT_OPTIONS,
  THEME_OPTIONS,
  TIME_ZONE_OPTIONS
};
