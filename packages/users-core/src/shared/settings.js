import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";

const DEFAULT_USER_SETTINGS = Object.freeze({
  theme: "system",
  locale: "en",
  timeZone: "UTC",
  dateFormat: "yyyy-mm-dd",
  numberFormat: "1,234.56",
  currencyCode: "USD",
  avatarSize: 64,
  productUpdates: true,
  accountActivity: true,
  securityAlerts: true,
  passwordSignInEnabled: true,
  passwordSetupRequired: false
});

// A saved locale is a canonical BCP 47 tag ("en-US"). Older rows were stored
// lowercased ("en-us"), so reads canonicalize too; a value that is not a valid tag
// keeps the lowercased form it always had.
function normalizeLocaleCode(value) {
  const locale = normalizeLowerText(value);
  if (!locale) {
    return "";
  }
  try {
    return Intl.getCanonicalLocales(locale)[0] || locale;
  } catch {
    return locale;
  }
}

export {
  DEFAULT_USER_SETTINGS,
  normalizeLocaleCode
};
