import path from "node:path";
import { access, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import {
  loadAppConfigFromAppRoot,
  resolveMobileConfig
} from "@jskit-ai/kernel/server/support";
import { ensureArray, ensureObject } from "../shared/collectionUtils.js";
import { loadPackageRegistry } from "../cliRuntime/packageRegistries.js";
import { resolvePackageTemplateRoot } from "../cliRuntime/packageTemplateResolution.js";
import {
  interpolateFileMutationRecord,
  renderTemplateFile,
  resolveTemplateContextReplacementsForMutation
} from "../cliRuntime/mutations/templateContext.js";

const CAPACITOR_CONFIG_FILE = "capacitor.config.json";
const CAPACITOR_RUNTIME_PACKAGE_ID = "@jskit-ai/mobile-capacitor";
const PUBLIC_CONFIG_RELATIVE_PATH = path.join("config", "public.js");
const ANDROID_DIRECTORY_NAME = "android";
const ANDROID_MANIFEST_RELATIVE_PATH = path.join(
  ANDROID_DIRECTORY_NAME,
  "app",
  "src",
  "main",
  "AndroidManifest.xml"
);
const ANDROID_VARIABLES_RELATIVE_PATH = path.join(
  ANDROID_DIRECTORY_NAME,
  "variables.gradle"
);
const ANDROID_APP_BUILD_GRADLE_RELATIVE_PATH = path.join(
  ANDROID_DIRECTORY_NAME,
  "app",
  "build.gradle"
);
const ANDROID_STRINGS_RELATIVE_PATH = path.join(
  ANDROID_DIRECTORY_NAME,
  "app",
  "src",
  "main",
  "res",
  "values",
  "strings.xml"
);
const ANDROID_MAIN_JAVA_ROOT_RELATIVE_PATH = path.join(
  ANDROID_DIRECTORY_NAME,
  "app",
  "src",
  "main",
  "java"
);
const ANDROID_MAIN_KOTLIN_ROOT_RELATIVE_PATH = path.join(
  ANDROID_DIRECTORY_NAME,
  "app",
  "src",
  "main",
  "kotlin"
);
const MANAGED_DEEP_LINK_START_MARKER = "<!-- jskit-mobile-capacitor:deep-links:start -->";
const MANAGED_DEEP_LINK_END_MARKER = "<!-- jskit-mobile-capacitor:deep-links:end -->";
const MANAGED_MOBILE_CONFIG_START_MARKER = "// jskit-mobile-capacitor:config:start";
const MANAGED_MOBILE_CONFIG_END_MARKER = "// jskit-mobile-capacitor:config:end";

function normalizeRelativePosixPath(pathValue = "") {
  return String(pathValue || "")
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\/{2,}/gu, "/");
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function pathExists(targetPath = "") {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function humanizeAppName(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "Example App";
  }

  const words = normalized
    .replace(/^@/u, "")
    .replace(/[/._-]+/gu, " ")
    .split(/\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (words.length < 1) {
    return "Example App";
  }
  return words
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(" ");
}

function slugifyForIdentifier(value = "") {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (!normalizedValue) {
    return "exampleapp";
  }

  const packageLeaf = normalizedValue.split("/").filter(Boolean).pop() || normalizedValue;
  const rawParts = packageLeaf
    .replace(/[^a-z0-9]+/gu, " ")
    .split(/\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const genericSuffixParts = new Set(["app", "mobile", "web", "site", "client"]);
  const filteredParts = rawParts.filter((entry) => !genericSuffixParts.has(entry));
  const candidateParts = filteredParts.length > 0 ? filteredParts : rawParts;

  return candidateParts
    .join("")
    .replace(/^([0-9]+)/u, "")
    || "exampleapp";
}

function buildManagedMobileConfigStub({ packageJson = {} } = {}) {
  const packageName = String(packageJson?.name || "").trim();
  const packageVersion = String(packageJson?.version || "").trim() || "0.1.0";
  const scheme = slugifyForIdentifier(packageName);
  const appId = `ai.jskit.${scheme}`;
  const appName = humanizeAppName(packageName);

  return [
    `${MANAGED_MOBILE_CONFIG_START_MARKER}`,
    "config.mobile = {",
    "  enabled: true,",
    '  strategy: "capacitor",',
    `  appId: ${JSON.stringify(appId)},`,
    `  appName: ${JSON.stringify(appName)},`,
    '  assetMode: "bundled",',
    '  devServerUrl: "",',
    '  apiBaseUrl: "http://127.0.0.1:3000",',
    "  auth: {",
    '    callbackPath: "/auth/login",',
    `    customScheme: ${JSON.stringify(scheme)},`,
    "    appLinkDomains: []",
    "  },",
    "  android: {",
    `    packageName: ${JSON.stringify(appId)},`,
    "    minSdk: 26,",
    "    targetSdk: 35,",
    "    versionCode: 1,",
    `    versionName: ${JSON.stringify(packageVersion)}`,
    "  }",
    "};",
    `${MANAGED_MOBILE_CONFIG_END_MARKER}`
  ].join("\n");
}

function parseAndroidSdkDirFromLocalProperties(source = "") {
  const lines = String(source || "").split(/\r?\n/u);
  for (const line of lines) {
    const match = /^\s*sdk\.dir\s*=\s*(.+?)\s*$/u.exec(line);
    if (!match) {
      continue;
    }
    return match[1].replace(/\\:/gu, ":").replace(/\\\\/gu, "\\").trim();
  }
  return "";
}

function buildAndroidNativeConfig(mobileConfig = {}) {
  const packageName = String(mobileConfig?.android?.packageName || "").trim();
  const appName = String(mobileConfig?.appName || "").trim();
  const customScheme = String(mobileConfig?.auth?.customScheme || "").trim().toLowerCase();
  const minSdk = String(mobileConfig?.android?.minSdk || "").trim();
  const targetSdk = String(mobileConfig?.android?.targetSdk || "").trim();
  const versionCode = String(mobileConfig?.android?.versionCode || "").trim();
  const versionName = String(mobileConfig?.android?.versionName || "").trim();

  if (!packageName) {
    throw new Error("config.mobile.android.packageName is required before refreshing the Android shell.");
  }
  if (!appName) {
    throw new Error("config.mobile.appName is required before refreshing the Android shell.");
  }
  if (!customScheme) {
    throw new Error("config.mobile.auth.customScheme is required before refreshing the Android shell.");
  }
  if (!minSdk || !targetSdk || !versionCode || !versionName) {
    throw new Error("config.mobile.android min/target SDK and version fields are required before refreshing the Android shell.");
  }

  return Object.freeze({
    packageName,
    appName,
    customScheme,
    minSdk,
    compileSdk: targetSdk,
    targetSdk,
    versionCode,
    versionName
  });
}

function replaceRequiredPattern(source = "", pattern, replacement, label = "pattern") {
  const normalizedSource = String(source || "");
  if (!pattern.test(normalizedSource)) {
    throw new Error(`Could not locate ${label} while refreshing the Android shell.`);
  }
  return normalizedSource.replace(pattern, replacement);
}

function escapeXmlText(value = "") {
  return String(value || "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function replaceXmlStringValue(source = "", stringName = "", value = "") {
  const escapedValue = escapeXmlText(value);
  return replaceRequiredPattern(
    source,
    new RegExp(`(<string\\s+name="${escapeRegExp(stringName)}">)([\\s\\S]*?)(</string>)`, "u"),
    `$1${escapedValue}$3`,
    `strings.xml value ${stringName}`
  );
}

function renderAndroidVariablesGradleSource(source = "", nativeConfig = {}) {
  let nextSource = String(source || "");
  nextSource = replaceRequiredPattern(
    nextSource,
    /(minSdkVersion\s*=\s*)(\d+)/u,
    `$1${nativeConfig.minSdk}`,
    "variables.gradle minSdkVersion"
  );
  nextSource = replaceRequiredPattern(
    nextSource,
    /(compileSdkVersion\s*=\s*)(\d+)/u,
    `$1${nativeConfig.compileSdk}`,
    "variables.gradle compileSdkVersion"
  );
  nextSource = replaceRequiredPattern(
    nextSource,
    /(targetSdkVersion\s*=\s*)(\d+)/u,
    `$1${nativeConfig.targetSdk}`,
    "variables.gradle targetSdkVersion"
  );
  return nextSource;
}

function renderAndroidAppBuildGradleSource(source = "", nativeConfig = {}) {
  let nextSource = String(source || "");
  nextSource = replaceRequiredPattern(
    nextSource,
    /(namespace\s+)(["'])([^"']+)(["'])/u,
    `$1"${nativeConfig.packageName}"`,
    "app/build.gradle namespace"
  );
  nextSource = replaceRequiredPattern(
    nextSource,
    /(applicationId\s+)(["'])([^"']+)(["'])/u,
    `$1"${nativeConfig.packageName}"`,
    "app/build.gradle applicationId"
  );
  nextSource = replaceRequiredPattern(
    nextSource,
    /(versionCode\s+)(\d+)/u,
    `$1${nativeConfig.versionCode}`,
    "app/build.gradle versionCode"
  );
  nextSource = replaceRequiredPattern(
    nextSource,
    /(versionName\s+)(["'])([^"']+)(["'])/u,
    `$1"${nativeConfig.versionName}"`,
    "app/build.gradle versionName"
  );
  return nextSource;
}

function renderAndroidStringsSource(source = "", nativeConfig = {}) {
  let nextSource = String(source || "");
  nextSource = replaceXmlStringValue(nextSource, "app_name", nativeConfig.appName);
  nextSource = replaceXmlStringValue(nextSource, "title_activity_main", nativeConfig.appName);
  nextSource = replaceXmlStringValue(nextSource, "package_name", nativeConfig.packageName);
  nextSource = replaceXmlStringValue(nextSource, "custom_url_scheme", nativeConfig.customScheme);
  return nextSource;
}

function renderAndroidMainActivitySource(source = "", packageName = "", extension = ".java") {
  const normalizedExtension = String(extension || "").trim().toLowerCase();
  if (normalizedExtension === ".kt") {
    return replaceRequiredPattern(
      source,
      /^[ \t]*package[ \t]+[A-Za-z0-9_.]+[ \t]*$/mu,
      `package ${packageName}`,
      "MainActivity package declaration"
    );
  }

  return replaceRequiredPattern(
    source,
    /^[ \t]*package[ \t]+[A-Za-z0-9_.]+[ \t]*;[ \t]*$/mu,
    `package ${packageName};`,
    "MainActivity package declaration"
  );
}

async function listFilesRecursively(rootDirectoryPath = "") {
  const collected = [];
  if (!(await pathExists(rootDirectoryPath))) {
    return collected;
  }

  const entries = await readdir(rootDirectoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootDirectoryPath, entry.name);
    if (entry.isDirectory()) {
      collected.push(...await listFilesRecursively(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      collected.push(absolutePath);
    }
  }

  return collected;
}

async function resolveAndroidMainActivityEntry(appRoot = "") {
  const candidateRoots = [
    path.join(appRoot, ANDROID_MAIN_JAVA_ROOT_RELATIVE_PATH),
    path.join(appRoot, ANDROID_MAIN_KOTLIN_ROOT_RELATIVE_PATH)
  ];
  const candidates = [];

  for (const rootDirectoryPath of candidateRoots) {
    const files = await listFilesRecursively(rootDirectoryPath);
    for (const absolutePath of files) {
      if (path.basename(absolutePath) !== "MainActivity.java" && path.basename(absolutePath) !== "MainActivity.kt") {
        continue;
      }
      candidates.push({
        absolutePath,
        sourceRoot: rootDirectoryPath,
        extension: path.extname(absolutePath)
      });
    }
  }

  if (candidates.length < 1) {
    return null;
  }
  if (candidates.length > 1) {
    throw new Error("Found multiple MainActivity source files in the Android shell.");
  }
  return candidates[0];
}

async function resolveInstalledMobileConfig(appRoot = "") {
  const mergedAppConfig = await loadAppConfigFromAppRoot({
    appRoot
  });
  return resolveMobileConfig({
    mobile: mergedAppConfig.mobile
  });
}

async function resolveAndroidSdkDetails({ appRoot = "" } = {}) {
  const envSdkRoot = String(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "").trim();
  if (envSdkRoot) {
    return Object.freeze({
      source: process.env.ANDROID_HOME ? "ANDROID_HOME" : "ANDROID_SDK_ROOT",
      sdkRoot: envSdkRoot
    });
  }

  const localPropertiesPath = path.join(appRoot, ANDROID_DIRECTORY_NAME, "local.properties");
  if (!(await pathExists(localPropertiesPath))) {
    return Object.freeze({
      source: "",
      sdkRoot: ""
    });
  }

  const localPropertiesSource = await readFile(localPropertiesPath, "utf8");
  const sdkRoot = parseAndroidSdkDirFromLocalProperties(localPropertiesSource);
  return Object.freeze({
    source: sdkRoot ? "android/local.properties" : "",
    sdkRoot
  });
}

async function collectAndroidSdkComponentIssues({ appRoot = "", sdkRoot = "" } = {}) {
  const issues = [];
  const normalizedSdkRoot = String(sdkRoot || "").trim();
  if (!normalizedSdkRoot) {
    return issues;
  }

  const variablesGradlePath = path.join(appRoot, ANDROID_VARIABLES_RELATIVE_PATH);
  if (!(await pathExists(variablesGradlePath))) {
    return issues;
  }

  const variablesGradleSource = await readFile(variablesGradlePath, "utf8");
  const compileSdkMatch = /compileSdkVersion\s*=\s*(\d+)/u.exec(variablesGradleSource);
  const compileSdkVersion = String(compileSdkMatch?.[1] || "").trim();
  if (compileSdkVersion) {
    const platformDirectoryPath = path.join(
      normalizedSdkRoot,
      "platforms",
      `android-${compileSdkVersion}`
    );
    if (!(await pathExists(platformDirectoryPath))) {
      issues.push(
        `Android SDK platform android-${compileSdkVersion} is missing under ${normalizedSdkRoot}.`
      );
    }
  }

  const buildToolsRoot = path.join(normalizedSdkRoot, "build-tools");
  if (!(await pathExists(buildToolsRoot))) {
    issues.push(`Android SDK build-tools directory is missing under ${normalizedSdkRoot}.`);
    return issues;
  }

  const buildToolsEntries = await readdir(buildToolsRoot, { withFileTypes: true });
  const hasBuildToolsVersion = buildToolsEntries.some((entry) => entry.isDirectory());
  if (!hasBuildToolsVersion) {
    issues.push(`Android SDK build-tools has no installed versions under ${buildToolsRoot}.`);
  }

  const licensesRoot = path.join(normalizedSdkRoot, "licenses");
  if (!(await pathExists(licensesRoot))) {
    issues.push(`Android SDK licenses directory is missing under ${normalizedSdkRoot}. Run sdkmanager --licenses after installing the required components.`);
    return issues;
  }

  const licenseEntries = await readdir(licensesRoot, { withFileTypes: true });
  const hasLicenseFiles = licenseEntries.some((entry) => entry.isFile());
  if (!hasLicenseFiles) {
    issues.push(`Android SDK licenses are not accepted under ${licensesRoot}. Run sdkmanager --licenses before building the Android shell.`);
  }

  return issues;
}

async function assertAndroidSdkConfigured({ ctx, appRoot } = {}) {
  const { createCliError } = ctx;
  const sdkDetails = await resolveAndroidSdkDetails({
    appRoot
  });
  if (!sdkDetails.sdkRoot) {
    throw createCliError(
      `Android SDK location is not configured. Set ANDROID_HOME or ANDROID_SDK_ROOT, or create android/local.properties with sdk.dir=... before running the Android shell.`
    );
  }
  if (!(await pathExists(sdkDetails.sdkRoot))) {
    throw createCliError(
      `Configured Android SDK path does not exist: ${sdkDetails.sdkRoot} (${sdkDetails.source}).`
    );
  }
  const componentIssues = await collectAndroidSdkComponentIssues({
    appRoot,
    sdkRoot: sdkDetails.sdkRoot
  });
  if (componentIssues.length > 0) {
    throw createCliError(componentIssues.join(" "));
  }

  return sdkDetails;
}

async function ensureMobileConfigStub({
  ctx,
  appRoot,
  packageJson = {},
  dryRun = false,
  stdout
} = {}) {
  const {
    normalizeRelativePath
  } = ctx;
  const publicConfigPath = path.join(appRoot, PUBLIC_CONFIG_RELATIVE_PATH);
  const currentSource = await readFile(publicConfigPath, "utf8");
  if (/\bconfig\.mobile\b|\bmobile\s*:/u.test(currentSource)) {
    return false;
  }

  const stubSource = buildManagedMobileConfigStub({
    packageJson
  });
  const nextSource = `${String(currentSource || "").replace(/\s*$/u, "")}\n\n${stubSource}\n`;

  if (dryRun === true) {
    stdout?.write(`[dry-run] append managed mobile config to ${normalizeRelativePath(appRoot, publicConfigPath)}\n`);
    return true;
  }

  await writeFile(publicConfigPath, nextSource, "utf8");
  stdout?.write(`[mobile] Added managed mobile config stub to ${normalizeRelativePath(appRoot, publicConfigPath)}.\n`);
  return true;
}

function buildManagedDeepLinkIntentFilterBlock(mobileConfig = {}) {
  const customScheme = String(mobileConfig?.auth?.customScheme || "").trim().toLowerCase();
  if (!customScheme) {
    throw new Error("config.mobile.auth.customScheme is required before wiring Android deep links.");
  }

  return [
    `            ${MANAGED_DEEP_LINK_START_MARKER}`,
    '            <intent-filter>',
    '                <action android:name="android.intent.action.VIEW" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <category android:name="android.intent.category.BROWSABLE" />',
    `                <data android:scheme="${customScheme}" />`,
    "            </intent-filter>",
    `            ${MANAGED_DEEP_LINK_END_MARKER}`
  ].join("\n");
}

function shouldAllowAndroidCleartextTraffic(mobileConfig = {}) {
  const assetMode = String(mobileConfig?.assetMode || "").trim().toLowerCase();
  const devServerUrl = String(mobileConfig?.devServerUrl || "").trim();
  const apiBaseUrl = String(mobileConfig?.apiBaseUrl || "").trim();

  if (assetMode === "dev_server" && devServerUrl) {
    try {
      if (String(new URL(devServerUrl).protocol || "").toLowerCase() === "http:") {
        return true;
      }
    } catch {}
  }

  if (apiBaseUrl) {
    try {
      if (String(new URL(apiBaseUrl).protocol || "").toLowerCase() === "http:") {
        return true;
      }
    } catch {}
  }

  return false;
}

function renderAndroidManifestApplicationTrafficPolicy(manifestSource = "", mobileConfig = {}) {
  const normalizedSource = String(manifestSource || "");
  if (!normalizedSource) {
    throw new Error("AndroidManifest.xml is empty.");
  }

  const applicationPattern = /(<application\b)([\s\S]*?)(>)/u;
  const match = applicationPattern.exec(normalizedSource);
  if (!match) {
    throw new Error("Could not locate <application> in AndroidManifest.xml.");
  }

  const allowCleartext = shouldAllowAndroidCleartextTraffic(mobileConfig);
  let applicationAttributes = String(match[2] || "");
  applicationAttributes = applicationAttributes.replace(/\s+android:usesCleartextTraffic="(?:true|false)"/gu, "");
  if (allowCleartext) {
    applicationAttributes = `${applicationAttributes} android:usesCleartextTraffic="true"`;
  }

  return normalizedSource.replace(applicationPattern, `$1${applicationAttributes}$3`);
}

function renderManagedAndroidManifest(manifestSource = "", mobileConfig = {}) {
  const manifestWithTrafficPolicy = renderAndroidManifestApplicationTrafficPolicy(manifestSource, mobileConfig);
  const managedBlock = buildManagedDeepLinkIntentFilterBlock(mobileConfig);
  return injectManagedDeepLinkBlock(manifestWithTrafficPolicy, managedBlock);
}

function injectManagedDeepLinkBlock(manifestSource = "", managedBlock = "") {
  const normalizedSource = String(manifestSource || "");
  const normalizedManagedBlock = String(managedBlock || "").trim();
  if (!normalizedSource) {
    throw new Error("AndroidManifest.xml is empty.");
  }
  if (!normalizedManagedBlock) {
    throw new Error("Managed deep-link block is empty.");
  }

  const managedBlockPattern = new RegExp(
    `\\n?\\s*${escapeRegExp(MANAGED_DEEP_LINK_START_MARKER)}[\\s\\S]*?${escapeRegExp(MANAGED_DEEP_LINK_END_MARKER)}\\n?`,
    "u"
  );
  const sourceWithoutManagedBlock = normalizedSource.replace(managedBlockPattern, "\n");
  const mainActivityPattern = /(<activity\b[^>]*android:name="\.MainActivity"[\s\S]*?>)([\s\S]*?)(\n\s*<\/activity>)/u;
  const match = mainActivityPattern.exec(sourceWithoutManagedBlock);
  if (!match) {
    throw new Error("Could not locate MainActivity in AndroidManifest.xml.");
  }

  const [, activityOpen, activityBody, activityClose] = match;
  const normalizedBody = String(activityBody || "").replace(/\s+$/u, "");
  const nextActivityBody = normalizedBody
    ? `${normalizedBody}\n\n${normalizedManagedBlock}`
    : `\n${normalizedManagedBlock}`;

  return sourceWithoutManagedBlock.replace(
    mainActivityPattern,
    `${activityOpen}${nextActivityBody}${activityClose}`
  );
}

async function assertCapacitorShellInstalled({ ctx, appRoot }) {
  const missingPaths = await collectCapacitorShellInstallIssues({
    ctx,
    appRoot
  });

  if (missingPaths.length > 0) {
    throw ctx.createCliError(
      `Capacitor Android shell is not installed for this app. Missing: ${missingPaths.join(", ")}. Run jskit mobile add capacitor first.`
    );
  }
}

async function collectCapacitorShellInstallIssues({ ctx, appRoot } = {}) {
  const {
    fileExists,
    path: pathModule,
    normalizeRelativePath
  } = ctx;
  const missingPaths = [];

  const capacitorConfigPath = pathModule.join(appRoot, CAPACITOR_CONFIG_FILE);
  if (!(await fileExists(capacitorConfigPath))) {
    missingPaths.push(normalizeRelativePath(appRoot, capacitorConfigPath));
  }

  const androidDirectoryPath = pathModule.join(appRoot, ANDROID_DIRECTORY_NAME);
  if (!(await fileExists(androidDirectoryPath))) {
    missingPaths.push(normalizeRelativePath(appRoot, androidDirectoryPath));
  }

  const requiredAndroidPaths = [
    ANDROID_MANIFEST_RELATIVE_PATH,
    ANDROID_APP_BUILD_GRADLE_RELATIVE_PATH,
    ANDROID_VARIABLES_RELATIVE_PATH,
    ANDROID_STRINGS_RELATIVE_PATH
  ];
  for (const relativePath of requiredAndroidPaths) {
    const absolutePath = pathModule.join(appRoot, relativePath);
    if (!(await fileExists(absolutePath))) {
      missingPaths.push(normalizeRelativePath(appRoot, absolutePath));
    }
  }

  const mainActivityEntry = await resolveAndroidMainActivityEntry(appRoot);
  if (!mainActivityEntry) {
    missingPaths.push("Android MainActivity source file");
  }

  return missingPaths;
}

async function ensureAndroidManifestDeepLinks({
  ctx,
  appRoot,
  dryRun = false,
  stdout
} = {}) {
  const {
    fileExists,
    path: pathModule,
    normalizeRelativePath,
    createCliError
  } = ctx;
  const manifestPath = pathModule.join(appRoot, ANDROID_MANIFEST_RELATIVE_PATH);
  if (!(await fileExists(manifestPath))) {
    throw createCliError(
      `Capacitor Android shell is missing ${normalizeRelativePath(appRoot, manifestPath)}. Run jskit mobile add capacitor first.`
    );
  }

  const mobileConfig = await resolveInstalledMobileConfig(appRoot);
  const currentManifestSource = await readFile(manifestPath, "utf8");
  const nextManifestSource = renderManagedAndroidManifest(currentManifestSource, mobileConfig);

  if (nextManifestSource === currentManifestSource) {
    return false;
  }

  if (dryRun === true) {
    stdout?.write(`[dry-run] refresh ${normalizeRelativePath(appRoot, manifestPath)}\n`);
    return true;
  }

  await writeFile(manifestPath, nextManifestSource, "utf8");
  stdout?.write(`[mobile] Refreshed ${normalizeRelativePath(appRoot, manifestPath)}.\n`);
  return true;
}

async function collectAndroidNativeShellIdentityIssues({ ctx, appRoot } = {}) {
  const {
    fileExists,
    path: pathModule,
    normalizeRelativePath
  } = ctx;
  const issues = [];
  const mobileConfig = await resolveInstalledMobileConfig(appRoot);
  const nativeConfig = buildAndroidNativeConfig(mobileConfig);
  const buildGradlePath = pathModule.join(appRoot, ANDROID_APP_BUILD_GRADLE_RELATIVE_PATH);
  const variablesGradlePath = pathModule.join(appRoot, ANDROID_VARIABLES_RELATIVE_PATH);
  const stringsPath = pathModule.join(appRoot, ANDROID_STRINGS_RELATIVE_PATH);

  const compareRenderedFile = async (absolutePath, renderer) => {
    if (!(await fileExists(absolutePath))) {
      issues.push(`Missing ${normalizeRelativePath(appRoot, absolutePath)}.`);
      return;
    }
    const currentSource = await readFile(absolutePath, "utf8");
    const expectedSource = renderer(currentSource, nativeConfig);
    if (currentSource !== expectedSource) {
      issues.push(
        `${normalizeRelativePath(appRoot, absolutePath)} is stale and no longer matches config.mobile. Re-run jskit mobile sync android to refresh the Android shell.`
      );
    }
  };

  await compareRenderedFile(buildGradlePath, renderAndroidAppBuildGradleSource);
  await compareRenderedFile(variablesGradlePath, renderAndroidVariablesGradleSource);
  await compareRenderedFile(stringsPath, renderAndroidStringsSource);
  await compareRenderedFile(
    pathModule.join(appRoot, ANDROID_MANIFEST_RELATIVE_PATH),
    (currentSource) => renderManagedAndroidManifest(currentSource, mobileConfig)
  );

  const mainActivityEntry = await resolveAndroidMainActivityEntry(appRoot);
  if (!mainActivityEntry) {
    issues.push("Missing Android MainActivity source file.");
    return issues;
  }

  const expectedMainActivityPath = path.join(
    mainActivityEntry.sourceRoot,
    ...nativeConfig.packageName.split("."),
    `MainActivity${mainActivityEntry.extension}`
  );
  const currentMainActivitySource = await readFile(mainActivityEntry.absolutePath, "utf8");
  const expectedMainActivitySource = renderAndroidMainActivitySource(
    currentMainActivitySource,
    nativeConfig.packageName,
    mainActivityEntry.extension
  );
  if (
    mainActivityEntry.absolutePath !== expectedMainActivityPath ||
    currentMainActivitySource !== expectedMainActivitySource
  ) {
    issues.push(
      `${normalizeRelativePath(appRoot, mainActivityEntry.absolutePath)} is stale and no longer matches config.mobile. Re-run jskit mobile sync android to refresh the Android shell.`
    );
  }

  return issues;
}

async function ensureAndroidNativeShellIdentity({
  ctx,
  appRoot,
  dryRun = false,
  stdout
} = {}) {
  const {
    fileExists,
    path: pathModule,
    normalizeRelativePath,
    createCliError
  } = ctx;
  const mobileConfig = await resolveInstalledMobileConfig(appRoot);
  const nativeConfig = buildAndroidNativeConfig(mobileConfig);
  let touched = false;
  const refreshRenderedFile = async (relativePath, renderer) => {
    const absolutePath = pathModule.join(appRoot, relativePath);
    if (!(await fileExists(absolutePath))) {
      throw createCliError(
        `Capacitor Android shell is missing ${normalizeRelativePath(appRoot, absolutePath)}. Run jskit mobile add capacitor first.`
      );
    }
    const currentSource = await readFile(absolutePath, "utf8");
    const nextSource = renderer(currentSource, nativeConfig);
    if (nextSource === currentSource) {
      return;
    }
    touched = true;
    if (dryRun === true) {
      stdout?.write(`[dry-run] refresh ${normalizeRelativePath(appRoot, absolutePath)}\n`);
      return;
    }
    await writeFile(absolutePath, nextSource, "utf8");
    stdout?.write(`[mobile] Refreshed ${normalizeRelativePath(appRoot, absolutePath)}.\n`);
  };

  await refreshRenderedFile(ANDROID_APP_BUILD_GRADLE_RELATIVE_PATH, renderAndroidAppBuildGradleSource);
  await refreshRenderedFile(ANDROID_VARIABLES_RELATIVE_PATH, renderAndroidVariablesGradleSource);
  await refreshRenderedFile(ANDROID_STRINGS_RELATIVE_PATH, renderAndroidStringsSource);
  await refreshRenderedFile(ANDROID_MANIFEST_RELATIVE_PATH, (currentSource) => renderManagedAndroidManifest(currentSource, mobileConfig));

  const mainActivityEntry = await resolveAndroidMainActivityEntry(appRoot);
  if (!mainActivityEntry) {
    throw createCliError("Capacitor Android shell is missing MainActivity.java or MainActivity.kt. Run jskit mobile add capacitor first.");
  }

  const currentMainActivitySource = await readFile(mainActivityEntry.absolutePath, "utf8");
  const nextMainActivitySource = renderAndroidMainActivitySource(
    currentMainActivitySource,
    nativeConfig.packageName,
    mainActivityEntry.extension
  );
  const nextMainActivityPath = path.join(
    mainActivityEntry.sourceRoot,
    ...nativeConfig.packageName.split("."),
    `MainActivity${mainActivityEntry.extension}`
  );
  if (
    nextMainActivitySource !== currentMainActivitySource ||
    nextMainActivityPath !== mainActivityEntry.absolutePath
  ) {
    touched = true;
    if (dryRun === true) {
      const currentRelativePath = normalizeRelativePath(appRoot, mainActivityEntry.absolutePath);
      const nextRelativePath = normalizeRelativePath(appRoot, nextMainActivityPath);
      if (currentRelativePath === nextRelativePath) {
        stdout?.write(`[dry-run] refresh ${currentRelativePath}\n`);
      } else {
        stdout?.write(`[dry-run] move ${currentRelativePath} -> ${nextRelativePath}\n`);
      }
    } else {
      await mkdir(path.dirname(nextMainActivityPath), { recursive: true });
      await writeFile(nextMainActivityPath, nextMainActivitySource, "utf8");
      if (nextMainActivityPath !== mainActivityEntry.absolutePath) {
        await unlink(mainActivityEntry.absolutePath);
      }
      const currentRelativePath = normalizeRelativePath(appRoot, mainActivityEntry.absolutePath);
      const nextRelativePath = normalizeRelativePath(appRoot, nextMainActivityPath);
      if (currentRelativePath === nextRelativePath) {
        stdout?.write(`[mobile] Refreshed ${nextRelativePath}.\n`);
      } else {
        stdout?.write(`[mobile] Moved ${currentRelativePath} -> ${nextRelativePath}.\n`);
      }
    }
  }

  return touched;
}

async function renderManagedMobileFile({
  appRoot,
  relativeTargetPath,
  packageId = CAPACITOR_RUNTIME_PACKAGE_ID
} = {}) {
  const normalizedTargetPath = normalizeRelativePosixPath(relativeTargetPath);
  if (!normalizedTargetPath) {
    throw new Error("relativeTargetPath is required to render a managed mobile file.");
  }

  const packageRegistry = await loadPackageRegistry();
  const packageEntry = packageRegistry.get(packageId);
  if (!packageEntry) {
    throw new Error(`Could not resolve package ${packageId} from the JSKIT package registry.`);
  }
  const templateRoot = await resolvePackageTemplateRoot({
    packageEntry,
    appRoot
  });
  const packageEntryForMutations =
    templateRoot === packageEntry.rootDir
      ? packageEntry
      : {
          ...packageEntry,
          rootDir: templateRoot
        };

  const mutation = ensureArray(ensureObject(packageEntryForMutations.descriptor).mutations?.files)
    .map((entry) => interpolateFileMutationRecord(ensureObject(entry), {}, packageEntryForMutations.packageId))
    .find((entry) => normalizeRelativePosixPath(entry.to) === normalizedTargetPath);
  if (!mutation) {
    throw new Error(`Package ${packageId} does not manage ${normalizedTargetPath}.`);
  }

  const sourcePath = path.join(packageEntryForMutations.rootDir, mutation.from);
  const targetPath = path.join(appRoot, mutation.to);
  const templateContextReplacements = await resolveTemplateContextReplacementsForMutation({
    packageEntry: packageEntryForMutations,
    mutation,
    options: {},
    appRoot,
    sourcePath,
    targetPaths: [targetPath],
    mutationContext: "files mutation"
  });

  return renderTemplateFile(
    sourcePath,
    {},
    packageEntryForMutations.packageId,
    `${mutation.id || mutation.to || mutation.from}.source`,
    templateContextReplacements
  );
}

export {
  CAPACITOR_CONFIG_FILE,
  ANDROID_DIRECTORY_NAME,
  ANDROID_MANIFEST_RELATIVE_PATH,
  buildManagedMobileConfigStub,
  resolveInstalledMobileConfig,
  resolveAndroidSdkDetails,
  collectAndroidSdkComponentIssues,
  assertAndroidSdkConfigured,
  collectCapacitorShellInstallIssues,
  ensureMobileConfigStub,
  buildManagedDeepLinkIntentFilterBlock,
  injectManagedDeepLinkBlock,
  assertCapacitorShellInstalled,
  ensureAndroidManifestDeepLinks,
  collectAndroidNativeShellIdentityIssues,
  ensureAndroidNativeShellIdentity,
  renderManagedMobileFile
};
