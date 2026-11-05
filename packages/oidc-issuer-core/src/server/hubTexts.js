import { createServerI18n } from "@jskit-ai/kernel/server/i18n";
import { catalogMessage, formatMessage, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import english from "../../locales/en.json" with { type: "json" };

/**
 * The English of one hub message code, rendered with its params. The hub's API
 * answers in English with the code, so the hub's pages can show it in the
 * person's language.
 * @param {string} messageCode
 * @param {Record<string, unknown>} [params]
 */
function hubEnglish(messageCode, params = {}) {
  const template = catalogMessage(english, messageKeyForCode(messageCode));
  if (template === undefined) {
    throw new TypeError(`Hub text "${messageCode}" is not in oidc-issuer-core's catalog.`);
  }
  return formatMessage(template, params);
}

/** An Accept-Language header's locales, most preferred first; q=0 means not acceptable. */
function acceptLanguages(header) {
  return String(header || "")
    .split(",")
    .map((part, index) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters.map((parameter) => parameter.trim()).find((parameter) => parameter.startsWith("q="));
      return { tag: tag.trim(), weight: quality ? Number(quality.slice(2)) : 1, index };
    })
    .filter((entry) => entry.tag && Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((left, right) => right.weight - left.weight || left.index - right.index)
    .map((entry) => entry.tag);
}

/** An OpenID Connect ui_locales value's locales, most preferred first. */
function uiLocales(value) {
  return String(value || "").split(/\s+/u).filter(Boolean);
}

/**
 * The hub's pages and emails in a person's language: the bundled English, any
 * extra English catalogs the host registers (later ones reword earlier ones), and
 * the app's translations in <appRoot>/src/locales/<code>/jskit.json.
 * @param {object} [options]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} [options.appRoot]
 * @param {ReadonlyArray<object>} [options.catalogs] Extra English catalogs from the host app.
 */
function createHubTexts({ appRoot = "", catalogs = [] } = {}) {
  const i18n = createServerI18n({ appRoot, catalogs: [english, ...catalogs] });

  /**
   * The locale to answer in: the authorization request's ui_locales first, then
   * the browser's Accept-Language, then English.
   * @param {{ uiLocales?: unknown, acceptLanguage?: unknown }} [request]
   */
  function localeFor({ uiLocales: requested = "", acceptLanguage = "" } = {}) {
    return i18n.resolveLocale([...uiLocales(requested), ...acceptLanguages(acceptLanguage)]);
  }

  return Object.freeze({
    t: i18n.t,
    localeFor
  });
}

export { acceptLanguages, createHubTexts, hubEnglish, uiLocales };
