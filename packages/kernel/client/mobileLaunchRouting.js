import { normalizePathname } from "../shared/surface/paths.js";
import { normalizeText } from "../shared/support/normalize.js";
import { resolveMobileConfig } from "./appConfig.js";

function buildNormalizedRoutePath(pathname = "/", search = "", hash = "") {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedSearch = String(search || "").trim().replace(/^\?+/, "");
  const normalizedHash = String(hash || "").trim();

  return `${normalizedPathname}${normalizedSearch ? `?${normalizedSearch}` : ""}${normalizedHash}`;
}

function normalizeResolvedRoutePath(value = "", fallback = "") {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return fallback;
  }

  try {
    const parsed = new URL(normalizedValue, "https://jskit.invalid");
    return buildNormalizedRoutePath(parsed.pathname, parsed.search, parsed.hash);
  } catch {
    return fallback;
  }
}

function normalizeAllowedHttpOrigins({ mobileConfig = {}, currentOrigin = "", allowedHttpOrigins = [] } = {}) {
  const origins = new Set();

  const maybeAddOrigin = (value = "") => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      return;
    }

    try {
      const parsed = new URL(normalizedValue);
      const protocol = String(parsed.protocol || "").toLowerCase();
      if (protocol !== "http:" && protocol !== "https:") {
        return;
      }
      origins.add(String(parsed.origin || "").trim().toLowerCase());
    } catch {}
  };

  maybeAddOrigin(currentOrigin);

  const explicitOrigins = Array.isArray(allowedHttpOrigins) ? allowedHttpOrigins : [allowedHttpOrigins];
  for (const entry of explicitOrigins) {
    maybeAddOrigin(entry);
  }

  const appLinkDomains = Array.isArray(mobileConfig?.auth?.appLinkDomains) ? mobileConfig.auth.appLinkDomains : [];
  for (const domain of appLinkDomains) {
    const normalizedDomain = normalizeText(domain).toLowerCase();
    if (!normalizedDomain) {
      continue;
    }
    maybeAddOrigin(`https://${normalizedDomain}`);
  }

  return origins;
}

function normalizeCustomSchemeRoutePath(parsedUrl) {
  const host = normalizeText(parsedUrl?.host);
  const pathname = normalizePathname(parsedUrl?.pathname || "/");

  if (!host) {
    return pathname;
  }

  if (pathname === "/") {
    return `/${host}`;
  }

  return normalizePathname(`/${host}${pathname}`);
}

function normalizeIncomingAppUrl(url = "", mobileConfig = {}, { currentOrigin = "", allowedHttpOrigins = [] } = {}) {
  const normalizedUrl = normalizeText(url);
  if (!normalizedUrl) {
    return "";
  }

  if (normalizedUrl.startsWith("/")) {
    try {
      const parsed = new URL(normalizedUrl, "https://jskit.invalid");
      return buildNormalizedRoutePath(parsed.pathname, parsed.search, parsed.hash);
    } catch {
      return "";
    }
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    return "";
  }

  const resolvedMobileConfig = resolveMobileConfig({
    mobile: mobileConfig
  });
  const allowedOrigins = normalizeAllowedHttpOrigins({
    mobileConfig: resolvedMobileConfig,
    currentOrigin,
    allowedHttpOrigins
  });
  const protocol = String(parsedUrl.protocol || "").toLowerCase();
  const customScheme = normalizeText(resolvedMobileConfig.auth.customScheme).toLowerCase();

  if (customScheme && protocol === `${customScheme}:`) {
    return buildNormalizedRoutePath(
      normalizeCustomSchemeRoutePath(parsedUrl),
      parsedUrl.search,
      parsedUrl.hash
    );
  }

  if ((protocol === "http:" || protocol === "https:") && allowedOrigins.has(String(parsedUrl.origin || "").toLowerCase())) {
    return buildNormalizedRoutePath(parsedUrl.pathname, parsedUrl.search, parsedUrl.hash);
  }

  return "";
}

function registerMobileLaunchRouting({
  router,
  mobileConfig = {},
  getInitialLaunchUrl = async () => "",
  subscribeToLaunchUrls = () => () => {},
  resolveTargetPath = null,
  currentOrigin = typeof window === "object" && window?.location ? String(window.location.origin || "") : "",
  allowedHttpOrigins = [],
  logger = null
} = {}) {
  if (!router || typeof router.replace !== "function") {
    throw new TypeError("registerMobileLaunchRouting requires router.replace().");
  }

  const resolvedMobileConfig = resolveMobileConfig({
    mobile: mobileConfig
  });
  const runtimeLogger =
    logger && typeof logger === "object"
      ? logger
      : {
          info() {},
          warn() {},
          error() {}
        };

  async function applyIncomingUrl(url = "", reason = "manual") {
    const normalizedTargetPath = normalizeIncomingAppUrl(url, resolvedMobileConfig, {
      currentOrigin,
      allowedHttpOrigins
    });
    if (!normalizedTargetPath) {
      return "";
    }

    let resolvedTargetPath = normalizedTargetPath;
    if (typeof resolveTargetPath === "function") {
      const nextTargetPath = await resolveTargetPath(
        Object.freeze({
          originalUrl: String(url || ""),
          normalizedTargetPath,
          reason,
          mobileConfig: resolvedMobileConfig,
          router
        })
      );
      resolvedTargetPath = normalizeResolvedRoutePath(nextTargetPath, normalizedTargetPath);
    }

    const currentFullPath = String(router.currentRoute?.value?.fullPath || "").trim();
    if (currentFullPath === resolvedTargetPath) {
      return resolvedTargetPath;
    }

    await router.replace(resolvedTargetPath);
    if (typeof runtimeLogger.info === "function") {
      runtimeLogger.info(
        {
          reason,
          targetPath: resolvedTargetPath
        },
        "Mobile launch routing applied incoming app URL."
      );
    }
    return resolvedTargetPath;
  }

  async function initialize() {
    if (resolvedMobileConfig.enabled !== true) {
      return "";
    }

    const initialLaunchUrl = await getInitialLaunchUrl();
    return applyIncomingUrl(initialLaunchUrl, "initial-launch");
  }

  const unsubscribe =
    resolvedMobileConfig.enabled === true
      ? subscribeToLaunchUrls((nextUrl) => {
          Promise.resolve(applyIncomingUrl(nextUrl, "launch-event")).catch((error) => {
            if (typeof runtimeLogger.warn === "function") {
              runtimeLogger.warn(
                {
                  error: String(error?.message || error || "unknown error")
                },
                "Mobile launch routing failed to apply incoming app URL."
              );
            }
          });
        })
      : () => {};

  return Object.freeze({
    initialize,
    dispose() {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    },
    applyIncomingUrl
  });
}

export { normalizeIncomingAppUrl, registerMobileLaunchRouting };
