import { resolveMobileConfig } from "@jskit-ai/kernel/client";
import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeHttpOrigin } from "@jskit-ai/kernel/shared/support/returnToPath";

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

function normalizeAllowedHttpOrigins({ mobileConfig, currentOrigin = "", allowedHttpOrigins = [] } = {}) {
  const origins = new Set();

  const maybeAddOrigin = (value = "") => {
    const origin = normalizeHttpOrigin(value);
    if (origin) {
      origins.add(origin);
    }
  };

  maybeAddOrigin(currentOrigin);

  const explicitOrigins = Array.isArray(allowedHttpOrigins) ? allowedHttpOrigins : [allowedHttpOrigins];
  for (const entry of explicitOrigins) {
    maybeAddOrigin(entry);
  }

  for (const domain of mobileConfig.auth.appLinkDomains) {
    maybeAddOrigin(`https://${domain}`);
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

// mobileConfig is the resolved config from resolveMobileConfig().
function normalizeIncomingAppUrl(url = "", mobileConfig, { currentOrigin = "", allowedHttpOrigins = [] } = {}) {
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

  const allowedOrigins = normalizeAllowedHttpOrigins({
    mobileConfig,
    currentOrigin,
    allowedHttpOrigins
  });
  const protocol = String(parsedUrl.protocol || "").toLowerCase();
  const customScheme = mobileConfig.auth.customScheme;

  if (customScheme && protocol === `${customScheme}:`) {
    return buildNormalizedRoutePath(
      normalizeCustomSchemeRoutePath(parsedUrl),
      parsedUrl.search,
      parsedUrl.hash
    );
  }

  if (allowedOrigins.has(normalizeHttpOrigin(normalizedUrl))) {
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
