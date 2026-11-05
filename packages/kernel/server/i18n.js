import fs from "node:fs";
import path from "node:path";
import { catalogMessage, formatMessage, mergeCatalogs } from "../shared/i18n/index.js";

// Renders JSKIT messages on the server, such as emails, in a recipient's language.
// English comes from the packages' bundled catalogs. An app's translations live in
// <appRoot>/src/locales/<code>/jskit.json, the file `jskit i18n export <code>` writes.
// A message is looked up in the exact locale, then its language (it-IT -> it), then
// English. App translation files are read once per process. resolveLocale picks,
// from a person's preferred locales, the first the app can show.

const ENGLISH = "en";
const APP_TRANSLATIONS_FILE = "jskit.json";
const appTranslationsByRoot = new Map();

/** Locale folders match case-insensitively: settings may store "it-it" for "it-IT". */
function loadAppTranslations(appRoot) {
  const directory = path.join(appRoot, "src", "locales");
  const catalogs = new Map();
  if (!fs.existsSync(directory)) {
    return catalogs;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name, APP_TRANSLATIONS_FILE);
    if (!entry.isDirectory() || !fs.existsSync(file)) {
      continue;
    }
    try {
      catalogs.set(entry.name.toLowerCase(), JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (error) {
      throw new Error(`Invalid JSKIT translations in ${file}: ${error.message}`, { cause: error });
    }
  }
  return catalogs;
}

function appTranslations(appRoot) {
  const root = path.resolve(appRoot);
  if (!appTranslationsByRoot.has(root)) {
    appTranslationsByRoot.set(root, loadAppTranslations(root));
  }
  return appTranslationsByRoot.get(root);
}

function localeCandidates(locale = "") {
  const code = String(locale || "").trim().replaceAll("_", "-").toLowerCase();
  return [...new Set([code, code.split("-")[0], ENGLISH].filter(Boolean))];
}

/**
 * @param {object} [options]
 * @param {import("./types.js").RuntimeAppRoot} [options.appRoot] The runtime.app-root capability, whose src/locales hold the app's translations; without one only English renders.
 * @param {ReadonlyArray<object>} [options.catalogs] The packages' bundled English catalogs.
 */
function createServerI18n({ appRoot = "", catalogs = [] } = {}) {
  const english = mergeCatalogs(...catalogs);

  function t(locale, key, params = {}) {
    const translations = appRoot ? appTranslations(appRoot) : new Map();
    for (const code of localeCandidates(locale)) {
      const message = catalogMessage(translations.get(code), key);
      if (message !== undefined) {
        return formatMessage(message, params);
      }
    }
    const message = catalogMessage(english, key);
    return message === undefined ? key : formatMessage(message, params);
  }

  /**
   * The first of a person's preferred locales (most preferred first, such as
   * ui_locales or Accept-Language) that the app has translations for, exactly or
   * by language, or English, which is always available.
   * @param {ReadonlyArray<string>} [preferences]
   * @returns {string}
   */
  function resolveLocale(preferences = []) {
    const translations = appRoot ? appTranslations(appRoot) : new Map();
    for (const preference of preferences) {
      const code = String(preference || "").trim().replaceAll("_", "-");
      const language = code.split("-")[0].toLowerCase();
      if (!language || language === "*") {
        continue;
      }
      if (translations.has(code.toLowerCase())) {
        return code;
      }
      if (language === ENGLISH || translations.has(language)) {
        return language;
      }
    }
    return ENGLISH;
  }

  return Object.freeze({
    t,
    resolveLocale
  });
}

export { createServerI18n };
