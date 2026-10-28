import fs from "node:fs";
import path from "node:path";
import { catalogMessage, formatMessage, mergeCatalogs } from "../shared/i18n/index.js";

// Renders JSKIT messages on the server, such as emails, in a recipient's language.
// English comes from the packages' bundled catalogs. An app's translations live in
// <appRoot>/src/locales/<code>/jskit.json, the file `jskit i18n export <code>` writes.
// A message is looked up in the exact locale, then its language (it-IT -> it), then
// English. App translation files are read once per process.

const ENGLISH = "en";
const APP_TRANSLATIONS_FILE = "jskit.json";
const appTranslationsByRoot = new Map();

// Locale folders match case-insensitively: settings may store "it-it" for "it-IT".
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

// appRoot is the runtime.app-root capability; without one only English renders.
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

  return Object.freeze({ t });
}

export { createServerI18n };
