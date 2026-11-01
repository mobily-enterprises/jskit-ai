import { normalizeText } from "../../shared/support/normalize.js";
import { normalizeMobileConfig } from "../../shared/support/mobileConfig.js";

/** @param {import("../types.js").RuntimeConfig} appConfig */
function resolveMobileConfig(appConfig) {
  return normalizeMobileConfig(appConfig.mobile);
}

/** @param {import("../types.js").RuntimeConfig} appConfig */
function resolveClientAssetMode(appConfig) {
  return resolveMobileConfig(appConfig).assetMode;
}

function buildWebCallbackUrl(appPublicUrl = "", callbackPath = "") {
  const normalizedAppPublicUrl = normalizeText(appPublicUrl);
  const normalizedCallbackPath = normalizeText(callbackPath);
  if (!normalizedAppPublicUrl || !normalizedCallbackPath) {
    return "";
  }

  try {
    const baseUrl = new URL(normalizedAppPublicUrl);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      return "";
    }

    if (!baseUrl.pathname.endsWith("/")) {
      baseUrl.pathname = `${baseUrl.pathname}/`;
    }
    baseUrl.search = "";
    baseUrl.hash = "";
    const relativeCallbackPath = normalizedCallbackPath.startsWith("/")
      ? normalizedCallbackPath.slice(1)
      : normalizedCallbackPath;
    return new URL(relativeCallbackPath, baseUrl).toString();
  } catch {
    return "";
  }
}

function buildMobileCallbackUrl(customScheme = "", callbackPath = "") {
  const normalizedScheme = normalizeText(customScheme).toLowerCase();
  const normalizedCallbackPath = normalizeText(callbackPath);
  if (!normalizedScheme || !normalizedCallbackPath) {
    return "";
  }

  const suffix = normalizedCallbackPath.startsWith("/") ? normalizedCallbackPath.slice(1) : normalizedCallbackPath;
  return suffix ? `${normalizedScheme}://${suffix}` : `${normalizedScheme}://`;
}

function buildAppLinkCallbackUrls(appLinkDomains = [], callbackPath = "") {
  const normalizedCallbackPath = normalizeText(callbackPath);
  if (!normalizedCallbackPath) {
    return Object.freeze([]);
  }

  const urls = (Array.isArray(appLinkDomains) ? appLinkDomains : [])
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean)
    .map((entry) => `https://${entry}${normalizedCallbackPath}`);

  return Object.freeze([...new Set(urls)]);
}

/**
 * @param {import("../types.js").RuntimeConfig} appConfig
 * @param {{ appPublicUrl?: string }} [options]
 */
function resolveMobileCallbackUrls(appConfig, { appPublicUrl = "" } = {}) {
  const mobileConfig = resolveMobileConfig(appConfig);
  const callbackPath = mobileConfig.auth.callbackPath;
  const webCallbackUrl = buildWebCallbackUrl(appPublicUrl, callbackPath);
  const mobileCallbackUrl = buildMobileCallbackUrl(mobileConfig.auth.customScheme, callbackPath);
  const appLinkCallbackUrls = buildAppLinkCallbackUrls(mobileConfig.auth.appLinkDomains, callbackPath);
  const callbackUrls = Object.freeze(
    [...new Set([webCallbackUrl, mobileCallbackUrl, ...appLinkCallbackUrls].filter(Boolean))]
  );

  return Object.freeze({
    callbackPath,
    webCallbackUrl,
    mobileCallbackUrl,
    appLinkCallbackUrls,
    callbackUrls
  });
}

export {
  resolveMobileConfig,
  resolveClientAssetMode,
  resolveMobileCallbackUrls
};
