import kernelEnglish from "../locales/en.json" with { type: "json" };
import { catalogMessage, formatMessage, mergeCatalogs, messageKeyForCode } from "../shared/i18n/index.js";

// JSKIT's English catalogs and the app's optional vue-i18n instance. Kept on
// globalThis like the client app config, so every copy of this module agrees.
const CLIENT_I18N_GLOBAL_KEY = "__JSKIT_CLIENT_I18N__";
const ENGLISH = "en";

function registry() {
  if (!globalThis[CLIENT_I18N_GLOBAL_KEY]) {
    globalThis[CLIENT_I18N_GLOBAL_KEY] = { english: {}, i18n: null };
  }
  return globalThis[CLIENT_I18N_GLOBAL_KEY];
}

// The app's own English messages win over JSKIT's, so an app can reword JSKIT.
function mergeEnglishIntoI18n() {
  const { english, i18n } = registry();
  if (i18n) {
    i18n.global.setLocaleMessage(ENGLISH, mergeCatalogs(english, i18n.global.getLocaleMessage(ENGLISH)));
  }
}

function registerJskitMessages(catalog = {}) {
  const state = registry();
  state.english = mergeCatalogs(state.english, catalog);
  mergeEnglishIntoI18n();
}

function setJskitI18n(i18n = null) {
  if (i18n && (i18n.mode !== "composition" || typeof i18n.global?.t !== "function")) {
    throw new TypeError("JSKIT needs a vue-i18n instance created with createI18n({ legacy: false }).");
  }
  registry().i18n = i18n || null;
  mergeEnglishIntoI18n();
}

// undefined keeps the browser's default locale, which is what JSKIT used before
// an app supplied vue-i18n.
function activeLocale() {
  const locale = registry().i18n?.global.locale;
  return (typeof locale === "object" && locale ? locale.value : locale) || undefined;
}

function pluralOptions(params) {
  const count = Number(params?.count ?? params?.n);
  return Number.isFinite(count) ? { plural: count } : {};
}

function t(key = "", params = {}) {
  const { english, i18n } = registry();
  if (i18n) {
    const composer = i18n.global;
    if (composer.te(key)) {
      return composer.t(key, params, pluralOptions(params));
    }
    if (composer.te(key, ENGLISH)) {
      return composer.t(key, params, { ...pluralOptions(params), locale: ENGLISH });
    }
  }
  const message = catalogMessage(english, key);
  return message === undefined ? key : formatMessage(message, params);
}

function hasMessage(key = "") {
  const { english, i18n } = registry();
  return catalogMessage(english, key) !== undefined || Boolean(i18n?.global.te(key));
}

// A placement label or title: a message key, { key, fallback, params }, or plain
// text shown as written.
function text(value) {
  if (value && typeof value === "object") {
    const key = String(value.key || "");
    return key && hasMessage(key) ? t(key, value.params) : String(value.fallback ?? "");
  }
  const label = String(value ?? "");
  return label && !/\s/u.test(label) && hasMessage(label) ? t(label) : label;
}

// A server code is translated only when the English the server sent is JSKIT's
// English for that code; an app's own sentence under a shared code stays as sent.
function codedMessage(code, params = {}, sentEnglish = "") {
  const key = messageKeyForCode(code);
  const english = key ? catalogMessage(registry().english, key) : undefined;
  if (english === undefined || (sentEnglish && formatMessage(english, params) !== sentEnglish)) {
    return "";
  }
  return t(key, params);
}

// An error or a success payload: its server code, or a messageCode for texts that
// have no error code (client-made errors, success statuses), then its English.
function serverMessage(source, fallback = "") {
  const sent = String(source?.message || "");
  return codedMessage(source?.code, source?.params, sent) ||
    codedMessage(source?.messageCode, source?.messageParams, sent) ||
    sent ||
    fallback;
}

function fieldErrorMessages(error) {
  const fieldErrors = error?.fieldErrors || error?.details?.fieldErrors || {};
  const fieldErrorCodes = error?.fieldErrorCodes || error?.details?.fieldErrorCodes || {};
  const messages = {};
  for (const [field, sent] of Object.entries(fieldErrors)) {
    const coded = fieldErrorCodes[field];
    messages[field] = (coded && codedMessage(coded.code, coded.params, String(sent || ""))) || sent;
  }
  return messages;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, options) {
  return validDate(value)?.toLocaleDateString(activeLocale(), options) ?? "";
}

function formatTime(value, options) {
  return validDate(value)?.toLocaleTimeString(activeLocale(), options) ?? "";
}

function formatDateTime(value, options) {
  return validDate(value)?.toLocaleString(activeLocale(), options) ?? "";
}

function formatNumber(value, options) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(activeLocale(), options) : "";
}

const RELATIVE_UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1]
];

function formatRelativeTime(value, { now = Date.now(), ...options } = {}) {
  const date = validDate(value);
  if (!date) {
    return "";
  }
  const seconds = Math.round((date.getTime() - Number(now)) / 1000);
  const [unit, size] = RELATIVE_UNITS.find(([, unitSeconds]) => Math.abs(seconds) >= unitSeconds) || RELATIVE_UNITS.at(-1);
  return new Intl.RelativeTimeFormat(activeLocale(), { numeric: "auto", ...options })
    .format(Math.round(seconds / size), unit);
}

function useJskitText() {
  return {
    t,
    text,
    hasMessage,
    errorMessage: serverMessage,
    serverMessage,
    fieldErrorMessages,
    formatDate,
    formatTime,
    formatDateTime,
    formatNumber,
    formatRelativeTime,
    get locale() {
      return activeLocale();
    }
  };
}

// The kernel is not a discovered package, so it registers its own catalog.
registerJskitMessages(kernelEnglish);

export {
  registerJskitMessages,
  setJskitI18n,
  useJskitText
};
