import path from "node:path";
import { readdir, rm } from "node:fs/promises";
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

async function directoryContainsAnyFiles(directoryPath = "") {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const absoluteChildPath = path.join(directoryPath, entry.name);
    if (entry.isFile() || entry.isSymbolicLink()) {
      return true;
    }
    if (entry.isDirectory() && await directoryContainsAnyFiles(absoluteChildPath)) {
      return true;
    }
  }
  return false;
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

async function prepareInstallHook({
  appRoot,
  appPackageJson = {},
  io,
  dryRun = false,
  helpers = {}
} = {}) {
  const ensureManagedMobileConfig = helpers?.ensureManagedMobileConfig;
  if (typeof ensureManagedMobileConfig !== "function") {
    throw new Error("install hook helpers.ensureManagedMobileConfig is required.");
  }

  const addedConfigStub = await ensureManagedMobileConfig({
    dryRun
  });
  if (dryRun === true && addedConfigStub) {
    return {
      stopInstall: true,
      touchedFiles: ["config/public.js"],
      stopMessage:
        "[dry-run] mobile package install preview stops after the config.mobile stub because rendered Capacitor files depend on those values."
    };
  }

  return {};
}

async function finalizeInstallHook({
  appRoot,
  io,
  dryRun = false,
  skipManagedFinalize = false,
  helpers = {}
} = {}) {
  if (skipManagedFinalize === true) {
    return {};
  }

  const installAppDependencies = helpers?.installAppDependencies;
  const runProjectBinary = helpers?.runProjectBinary;
  const helperFileExists = helpers?.fileExists;
  const collectShellInstallIssues = helpers?.collectCapacitorShellInstallIssues;
  const ensureDeepLinks = helpers?.ensureAndroidManifestDeepLinks;
  const ensureNativeShellIdentity = helpers?.ensureAndroidNativeShellIdentity;
  if (typeof installAppDependencies !== "function") {
    throw new Error("install hook helpers.installAppDependencies is required.");
  }
  if (typeof runProjectBinary !== "function") {
    throw new Error("install hook helpers.runProjectBinary is required.");
  }
  if (typeof helperFileExists !== "function") {
    throw new Error("install hook helpers.fileExists is required.");
  }
  if (typeof collectShellInstallIssues !== "function") {
    throw new Error("install hook helpers.collectCapacitorShellInstallIssues is required.");
  }
  if (typeof ensureDeepLinks !== "function") {
    throw new Error("install hook helpers.ensureAndroidManifestDeepLinks is required.");
  }
  if (typeof ensureNativeShellIdentity !== "function") {
    throw new Error("install hook helpers.ensureAndroidNativeShellIdentity is required.");
  }

  await installAppDependencies({
    dryRun
  });

  const androidDirectoryPath = path.join(appRoot, "android");
  const shellInstallIssues = await collectShellInstallIssues();
  if (shellInstallIssues.length < 1) {
    io?.stdout?.write("[mobile] Android shell is already installed. Skipping cap add android.\n");
  } else {
    if (await helperFileExists(androidDirectoryPath)) {
      io?.stdout?.write("[mobile] Android shell is partial or stale. Reprovisioning it with Capacitor CLI because these artifacts are missing:\n");
      for (const issue of shellInstallIssues) {
        io?.stdout?.write(`- ${issue}\n`);
      }
      const androidDirectoryHasFiles = await directoryContainsAnyFiles(androidDirectoryPath);
      if (!androidDirectoryHasFiles) {
        io?.stdout?.write("[mobile] android/ exists but contains no files. Removing the empty partial shell before reprovisioning.\n");
        if (!dryRun) {
          await rm(androidDirectoryPath, { recursive: true, force: true });
        }
      } else {
        throw new Error(
          "android/ exists but the Capacitor shell is incomplete. JSKIT will not delete a non-empty native tree automatically. Remove android/ and rerun the install."
        );
      }
    } else {
      io?.stdout?.write("[mobile] Android shell is not installed yet. Provisioning it with Capacitor CLI.\n");
    }
    await runProjectBinary("cap", ["add", "android"], {
      explanation: "[mobile] Provisioning Android shell with Capacitor CLI:",
      dryRun
    });
    if (!dryRun) {
      io?.stdout?.write("[mobile] Added Android shell with Capacitor CLI.\n");
    }
  }
  await ensureDeepLinks({
    dryRun
  });
  await ensureNativeShellIdentity({
    dryRun
  });
  return {
    touchedFiles: ["android"]
  };
}

export { buildTemplateContext, prepareInstallHook, finalizeInstallHook };
