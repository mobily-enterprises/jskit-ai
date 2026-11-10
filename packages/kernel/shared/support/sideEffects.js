/**
 * An application's side-effects setting, read from the `SIDE_EFFECTS`
 * environment variable. `live` acts on the outside world for real. Anything
 * else, unset included, is `simulate`: a test copy that sends no real email,
 * SMS, push notification, payment or third-party webhook on anyone's behalf,
 * writes each one to its log instead and shows a small "Test copy" banner.
 * The name has no platform prefix, so an application reads the same variable
 * on any host.
 */
const SIDE_EFFECTS_ENV_KEY = "SIDE_EFFECTS";
const SIDE_EFFECTS_LIVE = "live";
const SIDE_EFFECTS_SIMULATE = "simulate";

/**
 * The page's side-effects setting travels in this meta tag: the JSKIT server
 * adds it to every HTML page it sends, and JSKIT's Vite plugin to the pages its
 * development server sends, so the shell can show the "Test copy" banner with
 * no request and no application code.
 */
const SIDE_EFFECTS_META_NAME = "jskit-side-effects";
const SIDE_EFFECTS_META_PATTERN = new RegExp(`<meta name="${SIDE_EFFECTS_META_NAME}" content="[a-z]*">`, "u");
const HEAD_OPENING_PATTERN = /<head(?:\s[^>]*)?>/iu;

/**
 * `live` when the environment's SIDE_EFFECTS is exactly `live`, else `simulate`.
 * @param {Record<string, string | undefined>} env
 * @returns {"live" | "simulate"}
 */
function resolveSideEffectsMode(env) {
  return env[SIDE_EFFECTS_ENV_KEY] === SIDE_EFFECTS_LIVE ? SIDE_EFFECTS_LIVE : SIDE_EFFECTS_SIMULATE;
}

/**
 * True only when the environment's SIDE_EFFECTS is exactly `live`.
 * @param {Record<string, string | undefined>} env
 */
function sideEffectsAreLive(env) {
  return resolveSideEffectsMode(env) === SIDE_EFFECTS_LIVE;
}

/**
 * The page with its side-effects meta tag, first in its head: a page that has
 * one already gets it replaced, and text with no head is returned unchanged.
 * @param {string} html
 * @param {"live" | "simulate"} mode
 */
function withSideEffectsMeta(html, mode) {
  const tag = `<meta name="${SIDE_EFFECTS_META_NAME}" content="${mode}">`;
  if (SIDE_EFFECTS_META_PATTERN.test(html)) {
    return html.replace(SIDE_EFFECTS_META_PATTERN, tag);
  }
  const opening = HEAD_OPENING_PATTERN.exec(html);
  if (!opening) {
    return html;
  }
  const insertAt = opening.index + opening[0].length;
  return `${html.slice(0, insertAt)}${tag}${html.slice(insertAt)}`;
}

/**
 * The side-effects setting of the page this tab loaded: "live", "simulate", or
 * "" when the page names none (a page no JSKIT server or development server
 * sent, such as one bundled into a mobile app) or outside a browser.
 * @param {Document} [documentObject]
 * @returns {"live" | "simulate" | ""}
 */
function pageSideEffectsMode(documentObject = globalThis.document) {
  // readable-check: allow optional-call - platform object: there is no document outside a browser
  const meta = documentObject?.querySelector(`meta[name="${SIDE_EFFECTS_META_NAME}"]`);
  const content = String(meta?.getAttribute("content") || "").trim();
  return content === SIDE_EFFECTS_LIVE || content === SIDE_EFFECTS_SIMULATE ? content : "";
}

export {
  SIDE_EFFECTS_ENV_KEY,
  SIDE_EFFECTS_LIVE,
  SIDE_EFFECTS_META_NAME,
  SIDE_EFFECTS_SIMULATE,
  pageSideEffectsMode,
  resolveSideEffectsMode,
  sideEffectsAreLive,
  withSideEffectsMeta
};
