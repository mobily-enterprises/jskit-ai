import path from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  createColorFormatter,
  writeWrappedLines
} from "../shared/outputFormatting.js";
import {
  buildMobileCommandOptionMeta,
  listMobileCommandDefinitions,
  resolveMobileCommandDefinition
} from "./mobileCommandCatalog.js";
import {
  assertAndroidSdkConfigured,
  assertCapacitorShellInstalled,
  collectAndroidSdkComponentIssues,
  collectAndroidNativeShellIdentityIssues,
  ensureAndroidManifestDeepLinks,
  ensureAndroidNativeShellIdentity,
  renderManagedMobileFile,
  resolveAndroidSdkDetails,
  resolveInstalledMobileConfig
} from "./mobileShellSupport.js";
const CAPACITOR_RUNTIME_PACKAGE_ID = "@jskit-ai/mobile-capacitor";
const MOBILE_NOTES_RELATIVE_PATH = path.join(".jskit", "mobile-capacitor.md");

async function collectManagedMobileFileDriftIssues({
  ctx,
  appRoot,
  issues = []
} = {}) {
  const {
    fileExists,
    path: pathModule,
    normalizeRelativePath
  } = ctx;
  const managedRelativePaths = [
    "capacitor.config.json",
    MOBILE_NOTES_RELATIVE_PATH
  ];

  for (const relativePath of managedRelativePaths) {
    const absolutePath = pathModule.join(appRoot, relativePath);
    if (!(await fileExists(absolutePath))) {
      continue;
    }

    const currentContent = await readFile(absolutePath, "utf8");
    let expectedContent = "";
    try {
      expectedContent = await renderManagedMobileFile({
        appRoot,
        relativeTargetPath: relativePath
      });
    } catch (error) {
      issues.push(
        `Could not validate ${normalizeRelativePath(appRoot, absolutePath)} against the installed mobile package: ${String(error?.message || error || "unknown error")}`
      );
      continue;
    }
    if (currentContent !== expectedContent) {
      issues.push(
        `${normalizeRelativePath(appRoot, absolutePath)} is stale and no longer matches config.mobile. Re-run jskit mobile sync android to refresh managed mobile-shell files.`
      );
    }
  }
}

async function collectMissingInstalledDependencyNames(ctx, appRoot = "", packageJson = {}) {
  const {
    fileExists,
    path: pathModule
  } = ctx;
  const sections = [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.optionalDependencies
  ];
  const missing = [];
  const seen = new Set();

  for (const section of sections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }

    for (const packageName of Object.keys(section).sort((left, right) => left.localeCompare(right))) {
      const normalizedPackageName = String(packageName || "").trim();
      if (!normalizedPackageName || seen.has(normalizedPackageName)) {
        continue;
      }
      seen.add(normalizedPackageName);

      const packageJsonPath = pathModule.join(
        appRoot,
        "node_modules",
        ...normalizedPackageName.split("/"),
        "package.json"
      );
      if (!(await fileExists(packageJsonPath))) {
        missing.push(normalizedPackageName);
      }
    }
  }

  return missing;
}

function renderMobileHelp(stream, definition = null) {
  const color = createColorFormatter(stream);
  const lines = [];

  if (!definition) {
    lines.push(`Command: ${color.emphasis("mobile")}`);
    lines.push("");
    lines.push(color.heading("1) Minimal use"));
    lines.push("   jskit mobile <subcommand>");
    lines.push("");
    lines.push(color.heading("2) Subcommands"));
    for (const entry of listMobileCommandDefinitions()) {
      lines.push(`   - ${color.item(entry.name)}: ${entry.summary}`);
    }
    lines.push("");
    lines.push(color.heading("3) Notes"));
    lines.push("   - Mobile helpers are for the Stage 1 Android Capacitor shell flow.");
    lines.push("   - Use jskit mobile <subcommand> help for subcommand-specific usage.");
    writeWrappedLines({
      stdout: stream,
      lines
    });
    return;
  }

  lines.push(`Mobile subcommand: ${color.emphasis(definition.name)}`);
  lines.push("");
  lines.push(color.heading("1) Summary"));
  lines.push(`   ${definition.summary}`);
  lines.push("");
  lines.push(color.heading("2) Use"));
  lines.push(`   ${definition.usage}`);

  if (definition.options.length > 0) {
    lines.push("");
    lines.push(color.heading("3) Options"));
    for (const optionRow of definition.options) {
      lines.push(`   - ${optionRow.label}: ${optionRow.description}`);
    }
  }

  if (definition.defaults.length > 0) {
    lines.push("");
    lines.push(color.heading(definition.options.length > 0 ? "4) Defaults" : "3) Defaults"));
    for (const defaultLine of definition.defaults) {
      lines.push(`   - ${defaultLine}`);
    }
  }

  writeWrappedLines({
    stdout: stream,
    lines
  });
}

function isValidHttpOrHttpsUrl(value = "") {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return false;
  }

  try {
    const parsed = new URL(normalizedValue);
    const protocol = String(parsed.protocol || "").toLowerCase();
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeInlineOptions(options = {}) {
  return options?.inlineOptions && typeof options.inlineOptions === "object" ? options.inlineOptions : {};
}

function parsePortNumber(rawValue, {
  createCliError,
  optionLabel = "--port"
} = {}) {
  const normalizedValue = String(rawValue || "").trim();
  if (!normalizedValue) {
    return 0;
  }

  const numericValue = Number(normalizedValue);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 65535) {
    throw createCliError(`${optionLabel} must be an integer between 1 and 65535.`);
  }

  return numericValue;
}

function parseAdbDeviceList(output = "") {
  return String(output || "")
    .split(/\r?\n/u)
    .map((line) => String(line || "").trim())
    .filter((line) => line && line !== "List of devices attached")
    .map((line) => {
      const match = /^(\S+)\s+(\S+)(?:\s+(.*))?$/u.exec(line);
      if (!match) {
        return null;
      }
      return Object.freeze({
        serial: String(match[1] || "").trim(),
        state: String(match[2] || "").trim(),
        details: String(match[3] || "").trim()
      });
    })
    .filter(Boolean);
}

function resolveAdbReversePort({
  mobileConfig = null,
  explicitPort = "",
  createCliError
} = {}) {
  const parsedExplicitPort = parsePortNumber(explicitPort, {
    createCliError,
    optionLabel: "--port"
  });
  if (parsedExplicitPort > 0) {
    return parsedExplicitPort;
  }

  const apiBaseUrl = String(mobileConfig?.apiBaseUrl || "").trim();
  if (!apiBaseUrl) {
    throw createCliError("config.mobile.apiBaseUrl is required to infer the adb reverse port. Pass --port to override it.");
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(apiBaseUrl);
  } catch {
    throw createCliError("config.mobile.apiBaseUrl must be a valid absolute URL to infer the adb reverse port.");
  }

  const hostname = String(parsedUrl.hostname || "").trim().toLowerCase();
  const isLoopbackHost =
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]";
  if (!isLoopbackHost) {
    throw createCliError(
      `config.mobile.apiBaseUrl points at "${apiBaseUrl}", which is not a loopback host. Pass --port explicitly if you still need adb reverse.`
    );
  }

  const port = Number(parsedUrl.port || "");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw createCliError(
      `config.mobile.apiBaseUrl "${apiBaseUrl}" must include an explicit port so jskit mobile tunnel android can infer adb reverse.`
    );
  }

  return port;
}

async function runCapturedBinary(binaryName, args = [], {
  cwd = process.cwd(),
  env = {},
  createCliError,
  notFoundMessage = ""
} = {}) {
  const spawnedEnv = {
    ...process.env,
    ...env
  };

  return await new Promise((resolve, reject) => {
    const child = spawn(binaryName, Array.isArray(args) ? args : [], {
      cwd,
      env: spawnedEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(createCliError(notFoundMessage || `Could not find "${binaryName}" on PATH.`));
        return;
      }
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(Object.freeze({
          stdout,
          stderr
        }));
        return;
      }
      const renderedArgs = Array.isArray(args) ? args.join(" ") : "";
      const errorMessage = stderr.trim() || stdout.trim() || `${binaryName} ${renderedArgs}`.trim();
      reject(createCliError(`${binaryName}${renderedArgs ? ` ${renderedArgs}` : ""} failed: ${errorMessage}`));
    });
  });
}

async function listVisibleAndroidDevices({
  ctx,
  appRoot
} = {}) {
  const result = await runCapturedBinary("adb", ["devices", "-l"], {
    cwd: appRoot,
    createCliError: ctx.createCliError,
    notFoundMessage: 'Could not find "adb" on PATH. Install Android platform-tools first.'
  });
  return parseAdbDeviceList(result.stdout);
}

async function resolveAndroidDeviceTarget({
  ctx,
  appRoot,
  explicitTarget = "",
  commandLabel = "this mobile command"
} = {}) {
  const devices = await listVisibleAndroidDevices({
    ctx,
    appRoot
  });
  if (devices.length < 1) {
    throw ctx.createCliError(`No Android devices are visible to adb. Run jskit mobile devices android before ${commandLabel}.`);
  }

  const normalizedExplicitTarget = String(explicitTarget || "").trim();
  const selectedDevice = normalizedExplicitTarget
    ? devices.find((device) => device.serial === normalizedExplicitTarget) || null
    : devices[0];

  if (!selectedDevice) {
    throw ctx.createCliError(`Android device "${normalizedExplicitTarget}" is not visible to adb. Run jskit mobile devices android first.`);
  }
  if (selectedDevice.state !== "device") {
    throw ctx.createCliError(`Android device "${selectedDevice.serial}" is currently "${selectedDevice.state}", not ready for ${commandLabel}.`);
  }

  return selectedDevice;
}

async function resolveInstalledMobileConfigForCommand({
  appRoot,
  createCliError
} = {}) {
  try {
    return await resolveInstalledMobileConfig(appRoot);
  } catch (error) {
    const message = String(error?.message || error || "unknown error");
    throw createCliError(`config.mobile is invalid: ${message}`);
  }
}

async function runLocalBinary(binaryName, args = [], {
  appRoot,
  cwd = appRoot,
  env = {},
  stderr,
  stdout,
  pathModule,
  createCliError,
  dryRun = false
} = {}) {
  if (dryRun === true) {
    const renderedArgs = Array.isArray(args) ? args.join(" ") : "";
    stdout?.write(`[dry-run] ${binaryName}${renderedArgs ? ` ${renderedArgs}` : ""}\n`);
    return;
  }

  const localBinDirectory = pathModule.join(appRoot, "node_modules", ".bin");
  const inheritedPath = String(process.env.PATH || "");
  const spawnedEnv = {
    ...process.env,
    ...env,
    PATH: `${localBinDirectory}${pathModule.delimiter}${inheritedPath}`
  };

  await new Promise((resolve, reject) => {
    const child = spawn(binaryName, Array.isArray(args) ? args : [], {
      cwd,
      env: spawnedEnv,
      stdio: "inherit"
    });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(
          createCliError(
            `Could not find local "${binaryName}" in node_modules/.bin. Re-run jskit mobile add capacitor after npm install succeeds.`
          )
        );
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(createCliError(`${binaryName} ${args.join(" ")} failed with exit code ${code}.`));
    });
  }).catch((error) => {
    stderr.write(`${binaryName} failed: ${error.message}\n`);
    throw error;
  });
}

async function runMobileAppInstall({
  ctx,
  appRoot,
  stdout,
  stderr,
  dryRun = false,
  devlinks = false
} = {}) {
  const {
    path: pathModule,
    loadAppPackageJson
  } = ctx;
  const { packageJson } = await loadAppPackageJson(appRoot);
  const packageScripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};

  await runLocalBinary("npm", ["install"], {
    appRoot,
    stderr,
    stdout,
    pathModule,
    createCliError: ctx.createCliError,
    dryRun
  });

  if (devlinks === true && Object.prototype.hasOwnProperty.call(packageScripts, "devlinks")) {
    await runLocalBinary("npm", ["run", "--if-present", "devlinks"], {
      appRoot,
      stderr,
      stdout,
      pathModule,
      createCliError: ctx.createCliError,
      dryRun
    });
  }
}

async function refreshManagedMobileFiles({
  ctx,
  commandAdd,
  appRoot,
  options = {},
  stdout,
  stderr
} = {}) {
  const {
    path: pathModule
  } = ctx;
  const packageJsonPath = pathModule.join(appRoot, "package.json");
  const packageJsonBefore = await readFile(packageJsonPath, "utf8");
  let capturedStdout = "";
  await commandAdd({
    positional: ["package", CAPACITOR_RUNTIME_PACKAGE_ID],
    options: {
      ...options,
      forceReapplyTarget: true,
      runNpmInstall: false,
      inlineOptions: {}
    },
    cwd: appRoot,
    io: {
      stdout: {
        write(chunk) {
          capturedStdout += String(chunk || "");
        }
      },
      stderr
    }
  });
  const packageJsonAfter = await readFile(packageJsonPath, "utf8");
  const parsedPackageJsonAfter = JSON.parse(packageJsonAfter);
  const missingInstalledDependencies = await collectMissingInstalledDependencyNames(ctx, appRoot, parsedPackageJsonAfter);

  if (!/Touched files \(0\):/u.test(capturedStdout)) {
    stdout.write(capturedStdout);
  }

  if (
    options?.dryRun !== true &&
    (packageJsonAfter !== packageJsonBefore || missingInstalledDependencies.length > 0)
  ) {
    await runMobileAppInstall({
      ctx,
      appRoot,
      stdout,
      stderr,
      dryRun: false,
      devlinks: options?.devlinks === true
    });
  }
}

async function runMobileAddCapacitorCommand({
  commandAdd,
  appRoot,
  options = {},
  stdout,
  stderr
}) {
  return await commandAdd({
    positional: ["package", CAPACITOR_RUNTIME_PACKAGE_ID],
    options: {
      ...options,
      runNpmInstall: true,
      inlineOptions: {}
    },
    cwd: appRoot,
    io: {
      stdout,
      stderr
    }
  });
}

async function runMobileSyncAndroidCommand({
  ctx,
  commandAdd,
  appRoot,
  options = {},
  stdout,
  stderr
}) {
  const {
    path: pathModule
  } = ctx;

  await refreshManagedMobileFiles({
    ctx,
    commandAdd,
    appRoot,
    options,
    stdout,
    stderr
  });

  await assertCapacitorShellInstalled({
    ctx,
    appRoot
  });
  await ensureAndroidNativeShellIdentity({
    ctx,
    appRoot,
    dryRun: options?.dryRun === true,
    stdout
  });

  await runLocalBinary("npm", ["run", "build"], {
    appRoot,
    stderr,
    stdout,
    pathModule,
    createCliError: ctx.createCliError,
    dryRun: options?.dryRun === true
  });
  await runLocalBinary("cap", ["sync", "android"], {
    appRoot,
    stderr,
    stdout,
    pathModule,
    createCliError: ctx.createCliError,
    dryRun: options?.dryRun === true
  });
  await ensureAndroidManifestDeepLinks({
    ctx,
    appRoot,
    dryRun: options?.dryRun === true,
    stdout
  });

  if (options?.dryRun === true) {
    return 0;
  }

  stdout.write("[mobile] Built dist/ and synced the Android shell.\n");
  return 0;
}

async function runMobileRunAndroidCommand({
  ctx,
  commandAdd,
  appRoot,
  options = {},
  stdout,
  stderr
}) {
  const {
    path: pathModule
  } = ctx;
  const inlineOptions = normalizeInlineOptions(options);
  const target = String(inlineOptions.target || "").trim();
  const mobileConfig = await resolveInstalledMobileConfigForCommand({
    appRoot,
    createCliError: ctx.createCliError
  });
  if (options?.dryRun !== true) {
    await assertAndroidSdkConfigured({
      ctx,
      appRoot
    });
  }

  if (mobileConfig.assetMode === "bundled") {
    await runMobileSyncAndroidCommand({
      ctx,
      commandAdd,
      appRoot,
      options,
      stdout,
      stderr
    });
  } else {
    await refreshManagedMobileFiles({
      ctx,
      commandAdd,
      appRoot,
      options,
      stdout,
      stderr
    });

    await assertCapacitorShellInstalled({
      ctx,
      appRoot
    });
    await ensureAndroidNativeShellIdentity({
      ctx,
      appRoot,
      dryRun: options?.dryRun === true,
      stdout
    });
    await runLocalBinary("cap", ["sync", "android"], {
      appRoot,
      stderr,
      stdout,
      pathModule,
      createCliError: ctx.createCliError,
      dryRun: options?.dryRun === true
    });
    await ensureAndroidManifestDeepLinks({
      ctx,
      appRoot,
      dryRun: options?.dryRun === true,
      stdout
    });

    if (options?.dryRun !== true) {
      stdout.write("[mobile] Synced the Android shell against the configured dev server.\n");
    }
  }

  await runCapRunAndroidCommand({
    ctx,
    appRoot,
    pathModule,
    target,
    stdout,
    stderr,
    dryRun: options?.dryRun === true
  });

  if (options?.dryRun === true) {
    return 0;
  }

  stdout.write("[mobile] Ran the Android shell via Capacitor.\n");
  return 0;
}

async function runCapRunAndroidCommand({
  ctx,
  appRoot,
  pathModule,
  target = "",
  stdout,
  stderr,
  dryRun = false
} = {}) {
  const capRunArgs = ["run", "android"];
  if (target) {
    capRunArgs.push("--target", target);
  }

  await runLocalBinary("cap", capRunArgs, {
    appRoot,
    stderr,
    stdout,
    pathModule,
    createCliError: ctx.createCliError,
    dryRun
  });
}

async function runMobileBuildAndroidCommand({
  ctx,
  commandAdd,
  appRoot,
  options = {},
  stdout,
  stderr
}) {
  const {
    path: pathModule,
    createCliError
  } = ctx;
  const mobileConfig = await resolveInstalledMobileConfigForCommand({
    appRoot,
    createCliError
  });
  if (options?.dryRun !== true) {
    await assertAndroidSdkConfigured({
      ctx,
      appRoot
    });
  }

  if (mobileConfig.assetMode !== "bundled") {
    throw createCliError(
      'jskit mobile build android requires config.mobile.assetMode="bundled" so the release shell does not depend on a live dev server.'
    );
  }

  await runMobileSyncAndroidCommand({
    ctx,
    commandAdd,
    appRoot,
    options,
    stdout,
    stderr
  });

  const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  await runLocalBinary(gradleCommand, ["bundleRelease"], {
    appRoot,
    cwd: path.join(appRoot, "android"),
    stderr,
    stdout,
    pathModule,
    createCliError,
    dryRun: options?.dryRun === true
  });

  if (options?.dryRun === true) {
    return 0;
  }

  stdout.write("[mobile] Built the Android release AAB with Gradle.\n");
  return 0;
}

async function runMobileDoctorCommand({
  ctx,
  appRoot,
  stdout
}) {
  const {
    fileExists,
    createCliError,
    path: pathModule,
    normalizeRelativePath
  } = ctx;
  const issues = [];
  let mobileConfig = null;
  try {
    mobileConfig = await resolveInstalledMobileConfigForCommand({
      appRoot,
      createCliError
    });
  } catch (error) {
    issues.push(String(error?.message || error || "config.mobile is invalid."));
  }
  const sdkDetails = await resolveAndroidSdkDetails({
    appRoot
  });
  const capacitorConfigPath = pathModule.join(appRoot, "capacitor.config.json");
  const androidDirectoryPath = pathModule.join(appRoot, "android");
  const manifestPath = pathModule.join(appRoot, "android", "app", "src", "main", "AndroidManifest.xml");

  if (mobileConfig) {
    if (mobileConfig.enabled !== true) {
      issues.push("config.mobile.enabled must be true.");
    }
    if (mobileConfig.strategy !== "capacitor") {
      issues.push('config.mobile.strategy must be "capacitor".');
    }
    if (!mobileConfig.apiBaseUrl) {
      issues.push("config.mobile.apiBaseUrl must be set to the real JSKIT server origin.");
    } else if (mobileConfig.apiBaseUrl === "https://api.example.com") {
      issues.push("config.mobile.apiBaseUrl is still using the example placeholder.");
    }
    if (mobileConfig.assetMode === "dev_server") {
      if (!mobileConfig.devServerUrl) {
        issues.push('config.mobile.devServerUrl must be set when config.mobile.assetMode="dev_server".');
      } else if (!isValidHttpOrHttpsUrl(mobileConfig.devServerUrl)) {
        issues.push("config.mobile.devServerUrl must be a valid absolute http/https URL.");
      }
    }
    if (String(mobileConfig.appId || "").startsWith("com.example.")) {
      issues.push("config.mobile.appId is still using the example placeholder namespace.");
    }
    if (String(mobileConfig.android.packageName || "").startsWith("com.example.")) {
      issues.push("config.mobile.android.packageName is still using the example placeholder namespace.");
    }
  }
  if (!(await fileExists(capacitorConfigPath))) {
    issues.push(`Missing ${normalizeRelativePath(appRoot, capacitorConfigPath)}.`);
  }
  if (!(await fileExists(androidDirectoryPath))) {
    issues.push(`Missing ${normalizeRelativePath(appRoot, androidDirectoryPath)}.`);
  }
  if (!(await fileExists(manifestPath))) {
    issues.push(`Missing ${normalizeRelativePath(appRoot, manifestPath)}.`);
  } else if (mobileConfig) {
    const manifestSource = await readFile(manifestPath, "utf8");
    const customScheme = String(mobileConfig?.auth?.customScheme || "").trim().toLowerCase();
    if (customScheme && !manifestSource.includes(`android:scheme="${customScheme}"`)) {
      issues.push(
        `${normalizeRelativePath(appRoot, manifestPath)} is missing the managed deep-link filter for scheme "${customScheme}".`
      );
    }
  }
  if (!sdkDetails.sdkRoot) {
    issues.push("Android SDK location is not configured. Set ANDROID_HOME or ANDROID_SDK_ROOT, or add android/local.properties.");
  } else if (!(await fileExists(sdkDetails.sdkRoot))) {
    issues.push(`Configured Android SDK path does not exist: ${sdkDetails.sdkRoot} (${sdkDetails.source}).`);
  } else {
    issues.push(...await collectAndroidSdkComponentIssues({
      appRoot,
      sdkRoot: sdkDetails.sdkRoot
    }));
  }
  if (mobileConfig) {
    await collectManagedMobileFileDriftIssues({
      ctx,
      appRoot,
      issues
    });
    issues.push(...await collectAndroidNativeShellIdentityIssues({
      ctx,
      appRoot
    }));
  }

  if (issues.length > 0) {
    stdout.write("Mobile doctor found issues:\n");
    for (const issue of issues) {
      stdout.write(`- ${issue}\n`);
    }
    return 1;
  }

  stdout.write("Mobile doctor: Android Capacitor shell looks healthy.\n");
  return 0;
}

async function runMobileDevicesAndroidCommand({
  ctx,
  appRoot,
  stdout
}) {
  const devices = await listVisibleAndroidDevices({
    ctx,
    appRoot
  });

  if (devices.length < 1) {
    stdout.write("No Android devices visible to adb.\n");
    return 0;
  }

  stdout.write("Android devices:\n");
  for (const device of devices) {
    const detailSuffix = device.details ? ` ${device.details}` : "";
    stdout.write(`- ${device.serial} ${device.state}${detailSuffix}\n`);
  }
  return 0;
}

async function runMobileTunnelAndroidCommand({
  ctx,
  appRoot,
  options = {},
  stdout
}) {
  const inlineOptions = normalizeInlineOptions(options);
  const target = String(inlineOptions.target || "").trim();

  const mobileConfig = await resolveInstalledMobileConfigForCommand({
    appRoot,
    createCliError: ctx.createCliError
  });
  const port = resolveAdbReversePort({
    mobileConfig,
    explicitPort: inlineOptions.port,
    createCliError: ctx.createCliError
  });

  const matchingDevice = await resolveAndroidDeviceTarget({
    ctx,
    appRoot,
    explicitTarget: target,
    commandLabel: "adb reverse"
  });

  await runCapturedBinary("adb", ["-s", matchingDevice.serial, "reverse", `tcp:${port}`, `tcp:${port}`], {
    cwd: appRoot,
    createCliError: ctx.createCliError,
    notFoundMessage: 'Could not find "adb" on PATH. Install Android platform-tools first.'
  });
  const reverseListResult = await runCapturedBinary("adb", ["-s", matchingDevice.serial, "reverse", "--list"], {
    cwd: appRoot,
    createCliError: ctx.createCliError,
    notFoundMessage: 'Could not find "adb" on PATH. Install Android platform-tools first.'
  });

  stdout.write(`Android reverse tunnel ready for ${matchingDevice.serial}: tcp:${port} -> tcp:${port}\n`);
  const reverseLines = String(reverseListResult.stdout || "")
    .split(/\r?\n/u)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  if (reverseLines.length > 0) {
    stdout.write("adb reverse --list:\n");
    for (const line of reverseLines) {
      stdout.write(`- ${line}\n`);
    }
  }
  return 0;
}

async function runMobileRestartAndroidCommand({
  ctx,
  appRoot,
  options = {},
  stdout
}) {
  const inlineOptions = normalizeInlineOptions(options);
  const target = String(inlineOptions.target || "").trim();

  const mobileConfig = await resolveInstalledMobileConfigForCommand({
    appRoot,
    createCliError: ctx.createCliError
  });
  const packageName =
    String(mobileConfig?.android?.packageName || "").trim() ||
    String(mobileConfig?.appId || "").trim();
  if (!packageName) {
    throw ctx.createCliError("config.mobile.android.packageName or config.mobile.appId is required to restart the Android shell.");
  }

  const matchingDevice = await resolveAndroidDeviceTarget({
    ctx,
    appRoot,
    explicitTarget: target,
    commandLabel: "restart"
  });

  await runCapturedBinary("adb", ["-s", matchingDevice.serial, "shell", "pm", "clear", packageName], {
    cwd: appRoot,
    createCliError: ctx.createCliError,
    notFoundMessage: 'Could not find "adb" on PATH. Install Android platform-tools first.'
  });
  await runCapturedBinary("adb", ["-s", matchingDevice.serial, "shell", "am", "force-stop", packageName], {
    cwd: appRoot,
    createCliError: ctx.createCliError,
    notFoundMessage: 'Could not find "adb" on PATH. Install Android platform-tools first.'
  });
  await runCapturedBinary("adb", ["-s", matchingDevice.serial, "shell", "am", "start", "-W", "-n", `${packageName}/.MainActivity`], {
    cwd: appRoot,
    createCliError: ctx.createCliError,
    notFoundMessage: 'Could not find "adb" on PATH. Install Android platform-tools first.'
  });

  stdout.write(`Android app restarted on ${matchingDevice.serial}: ${packageName}\n`);
  return 0;
}

async function runMobileDevAndroidCommand({
  ctx,
  commandAdd,
  appRoot,
  options = {},
  stdout,
  stderr
}) {
  const inlineOptions = normalizeInlineOptions(options);
  const selectedDevice = await resolveAndroidDeviceTarget({
    ctx,
    appRoot,
    explicitTarget: inlineOptions.target,
    commandLabel: "the local Android dev flow"
  });

  stdout.write(`[mobile] Using Android device: ${selectedDevice.serial}\n`);
  stdout.write("[mobile] Building and syncing the Android shell:\n");
  stdout.write("[mobile]   npx jskit mobile sync android\n");
  await runMobileSyncAndroidCommand({
    ctx,
    commandAdd,
    appRoot,
    options,
    stdout,
    stderr
  });

  stdout.write(`[mobile] Installing and launching the app on ${selectedDevice.serial}:\n`);
  stdout.write(`[mobile]   npx jskit mobile run android --target ${selectedDevice.serial}\n`);
  await runCapRunAndroidCommand({
    ctx,
    appRoot,
    pathModule: ctx.path,
    target: selectedDevice.serial,
    stdout,
    stderr,
    dryRun: false
  });

  stdout.write(`[mobile] Creating the adb reverse tunnel on ${selectedDevice.serial}:\n`);
  stdout.write(`[mobile]   npx jskit mobile tunnel android --target ${selectedDevice.serial}\n`);
  await runMobileTunnelAndroidCommand({
    ctx,
    appRoot,
    options: {
      inlineOptions: {
        target: selectedDevice.serial
      }
    },
    stdout,
    stderr
  });

  return 0;
}

function createMobileCommands(ctx = {}, { commandAdd } = {}) {
  const {
    createCliError,
    resolveAppRootFromCwd
  } = ctx;

  if (typeof commandAdd !== "function") {
    throw new TypeError("createMobileCommands requires commandAdd().");
  }

  async function commandMobile({ positional = [], options = {}, cwd = "", stdout, stderr }) {
    const firstToken = String(positional[0] || "").trim();
    const secondToken = String(positional[1] || "").trim();
    const remainingPositionals = positional.slice(2);

    if (!firstToken) {
      renderMobileHelp(stdout);
      return 0;
    }

    if (firstToken === "help") {
      renderMobileHelp(stdout, resolveMobileCommandDefinition(secondToken));
      return 0;
    }

    const definition = resolveMobileCommandDefinition(firstToken);
    if (!definition) {
      throw createCliError(`Unknown mobile subcommand: ${firstToken}.`, {
        renderUsage: () => renderMobileHelp(stderr)
      });
    }

    if (secondToken === "help") {
      renderMobileHelp(stdout, definition);
      return 0;
    }

    const optionMeta = buildMobileCommandOptionMeta(definition.name);
    const supportedOptionNames = new Set(Object.keys(optionMeta));
    const inlineOptionNames = Object.keys(options?.inlineOptions && typeof options.inlineOptions === "object" ? options.inlineOptions : {});
    const unknownInlineOptionNames = inlineOptionNames.filter((optionName) => !supportedOptionNames.has(optionName));
    if (unknownInlineOptionNames.length > 0) {
      throw createCliError(
        `Unknown option${unknownInlineOptionNames.length === 1 ? "" : "s"} for jskit mobile ${definition.name}: ${unknownInlineOptionNames.map((optionName) => `--${optionName}`).join(", ")}.`,
        {
          renderUsage: () => renderMobileHelp(stderr, definition)
        }
      );
    }
    if (options?.dryRun === true && !supportedOptionNames.has("dry-run")) {
      throw createCliError(`Unknown option for jskit mobile ${definition.name}: --dry-run.`, {
        renderUsage: () => renderMobileHelp(stderr, definition)
      });
    }

    const appRoot = await resolveAppRootFromCwd(cwd);

    if (definition.name === "devices") {
      if (secondToken !== "android") {
        throw createCliError(`jskit mobile devices currently supports only "android".`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }
      if (remainingPositionals.length > 0) {
        throw createCliError(`Unexpected positional arguments for jskit mobile devices: ${remainingPositionals.join(" ")}`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }

      return runMobileDevicesAndroidCommand({
        ctx,
        appRoot,
        stdout,
        stderr
      });
    }

    if (definition.name === "dev") {
      if (secondToken !== "android") {
        throw createCliError(`jskit mobile dev currently supports only "android".`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }
      if (remainingPositionals.length > 0) {
        throw createCliError(`Unexpected positional arguments for jskit mobile dev: ${remainingPositionals.join(" ")}`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }

      return runMobileDevAndroidCommand({
        ctx,
        commandAdd,
        appRoot,
        options,
        stdout,
        stderr
      });
    }

    if (definition.name === "tunnel") {
      if (secondToken !== "android") {
        throw createCliError(`jskit mobile tunnel currently supports only "android".`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }
      if (remainingPositionals.length > 0) {
        throw createCliError(`Unexpected positional arguments for jskit mobile tunnel: ${remainingPositionals.join(" ")}`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }

      return runMobileTunnelAndroidCommand({
        ctx,
        appRoot,
        options,
        stdout,
        stderr
      });
    }

    if (definition.name === "restart") {
      if (secondToken !== "android") {
        throw createCliError(`jskit mobile restart currently supports only "android".`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }
      if (remainingPositionals.length > 0) {
        throw createCliError(`Unexpected positional arguments for jskit mobile restart: ${remainingPositionals.join(" ")}`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }

      return runMobileRestartAndroidCommand({
        ctx,
        appRoot,
        options,
        stdout,
        stderr
      });
    }

    if (definition.name === "add") {
      if (secondToken !== "capacitor") {
        throw createCliError(`jskit mobile add currently supports only "capacitor".`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }
      if (remainingPositionals.length > 0) {
        throw createCliError(`Unexpected positional arguments for jskit mobile add: ${remainingPositionals.join(" ")}`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }

      return runMobileAddCapacitorCommand({
        ctx,
        commandAdd,
        appRoot,
        options,
        stdout,
        stderr
      });
    }

    if (definition.name === "sync") {
      if (secondToken !== "android") {
        throw createCliError(`jskit mobile sync currently supports only "android".`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }
      if (remainingPositionals.length > 0) {
        throw createCliError(`Unexpected positional arguments for jskit mobile sync: ${remainingPositionals.join(" ")}`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }

      return runMobileSyncAndroidCommand({
        ctx,
        commandAdd,
        appRoot,
        options,
        stdout,
        stderr
      });
    }

    if (definition.name === "run") {
      if (secondToken !== "android") {
        throw createCliError(`jskit mobile run currently supports only "android".`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }
      if (remainingPositionals.length > 0) {
        throw createCliError(`Unexpected positional arguments for jskit mobile run: ${remainingPositionals.join(" ")}`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }

      return runMobileRunAndroidCommand({
        ctx,
        commandAdd,
        appRoot,
        options,
        stdout,
        stderr
      });
    }

    if (definition.name === "build") {
      if (secondToken !== "android") {
        throw createCliError(`jskit mobile build currently supports only "android".`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }
      if (remainingPositionals.length > 0) {
        throw createCliError(`Unexpected positional arguments for jskit mobile build: ${remainingPositionals.join(" ")}`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }

      return runMobileBuildAndroidCommand({
        ctx,
        commandAdd,
        appRoot,
        options,
        stdout,
        stderr
      });
    }

    if (definition.name === "doctor") {
      if (secondToken) {
        throw createCliError(`Unexpected positional arguments for jskit mobile doctor: ${[secondToken, ...remainingPositionals].join(" ")}`, {
          renderUsage: () => renderMobileHelp(stderr, definition)
        });
      }

      return runMobileDoctorCommand({
        ctx,
        appRoot,
        stdout,
        stderr
      });
    }

    throw createCliError(`Unhandled mobile subcommand: ${definition.name}.`, {
      renderUsage: () => renderMobileHelp(stderr, definition)
    });
  }

  return {
    commandMobile
  };
}

export { createMobileCommands };
