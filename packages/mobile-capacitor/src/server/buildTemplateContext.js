import path from "node:path";
import { loadAppConfigFromAppRoot, resolveMobileConfig } from "@jskit-ai/kernel/server/support";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function requireNonEmptyText(value, label = "value") {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${label} is required in config.mobile before installing Capacitor support.`);
  }
  return normalized;
}

function requireUrl(value, label = "value", { allowHttp = true, allowHttps = true } = {}) {
  const normalized = requireNonEmptyText(value, label);
  let parsed = null;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${label} must be a valid absolute URL in config.mobile.`);
  }

  const protocol = String(parsed.protocol || "").toLowerCase();
  if ((protocol === "http:" && allowHttp !== true) || (protocol === "https:" && allowHttps !== true)) {
    throw new Error(`${label} must use an allowed protocol in config.mobile.`);
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`${label} must use http or https in config.mobile.`);
  }

  return parsed.toString();
}

function buildCapacitorServerBlock(mobileConfig = {}) {
  if (mobileConfig.assetMode !== "dev_server") {
    return "";
  }

  const devServerUrl = requireUrl(mobileConfig.devServerUrl, "config.mobile.devServerUrl");
  const cleartext = String(new URL(devServerUrl).protocol || "").toLowerCase() === "http:";

  return [
    ",",
    '  "server": {',
    `    "url": ${JSON.stringify(devServerUrl)},`,
    `    "cleartext": ${cleartext}`,
    "  }"
  ].join("\n");
}

function buildAppLinkDomainsValue(appLinkDomains = []) {
  const domains = Array.isArray(appLinkDomains) ? appLinkDomains : [];
  if (domains.length < 1) {
    return "(none)";
  }
  return domains.join(", ");
}

async function buildTemplateContext({ appRoot } = {}) {
  const mergedConfig = await loadAppConfigFromAppRoot({
    appRoot: path.resolve(String(appRoot || ""))
  });
  const mobileConfig = resolveMobileConfig({
    mobile: mergedConfig.mobile
  });

  if (mobileConfig.enabled !== true) {
    throw new Error("config.mobile.enabled must be true before installing Capacitor support.");
  }
  if (mobileConfig.strategy !== "capacitor") {
    throw new Error('config.mobile.strategy must be "capacitor" before installing Capacitor support.');
  }

  const appId = requireNonEmptyText(mobileConfig.appId, "config.mobile.appId");
  const appName = requireNonEmptyText(mobileConfig.appName, "config.mobile.appName");
  const apiBaseUrl = requireUrl(mobileConfig.apiBaseUrl, "config.mobile.apiBaseUrl");
  const callbackPath = requireNonEmptyText(mobileConfig.auth.callbackPath, "config.mobile.auth.callbackPath");
  const customScheme = requireNonEmptyText(mobileConfig.auth.customScheme, "config.mobile.auth.customScheme");
  const androidPackageName = requireNonEmptyText(
    mobileConfig.android.packageName,
    "config.mobile.android.packageName"
  );
  const androidVersionName = requireNonEmptyText(
    mobileConfig.android.versionName,
    "config.mobile.android.versionName"
  );

  return {
    "__JSKIT_MOBILE_CAPACITOR_APP_ID__": appId,
    "__JSKIT_MOBILE_CAPACITOR_APP_NAME__": appName,
    "__JSKIT_MOBILE_CAPACITOR_WEB_DIR__": "dist",
    "__JSKIT_MOBILE_CAPACITOR_SERVER_BLOCK__": buildCapacitorServerBlock(mobileConfig),
    "__JSKIT_MOBILE_CAPACITOR_ASSET_MODE__": mobileConfig.assetMode,
    "__JSKIT_MOBILE_CAPACITOR_DEV_SERVER_URL__": mobileConfig.devServerUrl || "(unused)",
    "__JSKIT_MOBILE_CAPACITOR_API_BASE_URL__": apiBaseUrl,
    "__JSKIT_MOBILE_CAPACITOR_CALLBACK_PATH__": callbackPath,
    "__JSKIT_MOBILE_CAPACITOR_CUSTOM_SCHEME__": customScheme,
    "__JSKIT_MOBILE_CAPACITOR_APP_LINK_DOMAINS__": buildAppLinkDomainsValue(mobileConfig.auth.appLinkDomains),
    "__JSKIT_MOBILE_CAPACITOR_ANDROID_PACKAGE_NAME__": androidPackageName,
    "__JSKIT_MOBILE_CAPACITOR_ANDROID_MIN_SDK__": String(mobileConfig.android.minSdk),
    "__JSKIT_MOBILE_CAPACITOR_ANDROID_TARGET_SDK__": String(mobileConfig.android.targetSdk),
    "__JSKIT_MOBILE_CAPACITOR_ANDROID_VERSION_CODE__": String(mobileConfig.android.versionCode),
    "__JSKIT_MOBILE_CAPACITOR_ANDROID_VERSION_NAME__": androidVersionName
  };
}

export { buildTemplateContext };
