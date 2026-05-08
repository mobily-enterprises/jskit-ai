import { normalizeMobileConfig, normalizeObject, normalizeText } from "../../shared/support/normalize.js";
import { normalizeSurfaceId } from "../../shared/surface/registry.js";

function resolveAppConfig(scope = null) {
  const source = scope && typeof scope === "object" ? scope : null;
  if (!source || typeof source.has !== "function" || typeof source.make !== "function") {
    return {};
  }
  if (!source.has("appConfig")) {
    return {};
  }

  return normalizeObject(source.make("appConfig"));
}

function normalizeDefaultSurfaceId(value, { fallback = "" } = {}) {
  const normalizedValue = normalizeSurfaceId(value);
  if (normalizedValue) {
    return normalizedValue;
  }

  const normalizedFallback = normalizeSurfaceId(fallback);
  if (normalizedFallback) {
    return normalizedFallback;
  }

  return "";
}

function resolveDefaultSurfaceId(scope = null, { defaultSurfaceId = "" } = {}) {
  const appConfig = resolveAppConfig(scope);
  return normalizeDefaultSurfaceId(defaultSurfaceId, {
    fallback: appConfig.surfaceDefaultId
  });
}

function resolveMobileConfig(source = null) {
  const appConfig =
    source && typeof source === "object" && typeof source.has === "function" && typeof source.make === "function"
      ? resolveAppConfig(source)
      : normalizeObject(source);

  return normalizeMobileConfig(appConfig.mobile);
}

function resolveClientAssetMode(source = null) {
  return resolveMobileConfig(source).assetMode;
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

function resolveMobileCallbackUrls(source = null, { appPublicUrl = "" } = {}) {
  const mobileConfig = resolveMobileConfig(source);
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
  resolveAppConfig,
  normalizeDefaultSurfaceId,
  resolveDefaultSurfaceId,
  resolveMobileConfig,
  resolveClientAssetMode,
  resolveMobileCallbackUrls
};
