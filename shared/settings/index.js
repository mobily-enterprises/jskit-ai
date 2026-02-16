export const SETTINGS_THEME_OPTIONS = ["system", "light", "dark"];
export const SETTINGS_DATE_FORMAT_OPTIONS = ["system", "mdy", "dmy", "ymd"];
export const SETTINGS_NUMBER_FORMAT_OPTIONS = ["system", "comma-dot", "dot-comma", "space-comma"];
export const SETTINGS_MODE_OPTIONS = ["fv", "pv"];
export const SETTINGS_TIMING_OPTIONS = ["ordinary", "due"];

export const SETTINGS_LOCALE_PATTERN = "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$";
export const SETTINGS_CURRENCY_CODE_PATTERN = "^[A-Z]{3}$";

export const SETTINGS_DEFAULTS = {
  theme: "system",
  locale: "en-US",
  timeZone: "UTC",
  dateFormat: "system",
  numberFormat: "system",
  currencyCode: "USD",
  defaultMode: "fv",
  defaultTiming: "ordinary",
  defaultPaymentsPerYear: 12,
  defaultHistoryPageSize: 10,
  productUpdates: true,
  accountActivity: true,
  securityAlerts: true
};
