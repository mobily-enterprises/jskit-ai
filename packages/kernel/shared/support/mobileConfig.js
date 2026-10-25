import {
  hasValue,
  normalizeBoolean,
  normalizeLowerText,
  normalizeObject,
  normalizePositiveInteger,
  normalizeText,
  normalizeUniqueTextList
} from "./normalize.js";

const MOBILE_ASSET_MODES = Object.freeze(["bundled", "dev_server"]);
const MOBILE_STRATEGIES = Object.freeze(["capacitor"]);
const DEFAULT_MOBILE_AUTH_CONFIG = Object.freeze({
  callbackPath: "/auth/login",
  customScheme: "",
  appLinkDomains: Object.freeze([])
});
const DEFAULT_MOBILE_ANDROID_CONFIG = Object.freeze({
  packageName: "",
  minSdk: 26,
  targetSdk: 35,
  versionCode: 1,
  versionName: "1.0.0"
});

function normalizeMobileStrategy(value = "", { fallback = "" } = {}) {
  const normalized = normalizeLowerText(value);
  return MOBILE_STRATEGIES.includes(normalized) ? normalized : normalizeLowerText(fallback);
}

function normalizeMobileAssetMode(value = "", { fallback = "bundled" } = {}) {
  const normalized = normalizeLowerText(value);
  if (!normalized) {
    return normalizeLowerText(fallback, {
      fallback: "bundled"
    });
  }
  if (!MOBILE_ASSET_MODES.includes(normalized)) {
    throw new TypeError('config.mobile.assetMode must be "bundled" or "dev_server".');
  }
  return normalized;
}

function normalizeMobileCallbackPath(value = "", { fallback = "/auth/login" } = {}) {
  const normalized = normalizeText(value, {
    fallback
  });
  if (!normalized) {
    return "";
  }

  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeMobileConfig(source = {}) {
  const mobile = normalizeObject(source);
  const auth = normalizeObject(mobile.auth);
  const android = normalizeObject(mobile.android);

  return Object.freeze({
    enabled: hasValue(mobile.enabled) ? normalizeBoolean(mobile.enabled) : false,
    strategy: normalizeMobileStrategy(mobile.strategy),
    appId: normalizeText(mobile.appId),
    appName: normalizeText(mobile.appName),
    assetMode: normalizeMobileAssetMode(mobile.assetMode),
    devServerUrl: normalizeText(mobile.devServerUrl),
    apiBaseUrl: normalizeText(mobile.apiBaseUrl),
    auth: Object.freeze({
      callbackPath: normalizeMobileCallbackPath(auth.callbackPath, {
        fallback: DEFAULT_MOBILE_AUTH_CONFIG.callbackPath
      }),
      customScheme: normalizeLowerText(auth.customScheme),
      appLinkDomains: Object.freeze([
        ...new Set(
          normalizeUniqueTextList(auth.appLinkDomains, {
            acceptSingle: true
          }).map((entry) => normalizeLowerText(entry))
        )
      ])
    }),
    android: Object.freeze({
      packageName: normalizeText(android.packageName),
      minSdk: normalizePositiveInteger(android.minSdk, {
        fallback: DEFAULT_MOBILE_ANDROID_CONFIG.minSdk
      }),
      targetSdk: normalizePositiveInteger(android.targetSdk, {
        fallback: DEFAULT_MOBILE_ANDROID_CONFIG.targetSdk
      }),
      versionCode: normalizePositiveInteger(android.versionCode, {
        fallback: DEFAULT_MOBILE_ANDROID_CONFIG.versionCode
      }),
      versionName: normalizeText(android.versionName, {
        fallback: DEFAULT_MOBILE_ANDROID_CONFIG.versionName
      })
    })
  });
}

export { normalizeMobileCallbackPath, normalizeMobileConfig };
