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
  ensureMobileConfigStub,
  ensureAndroidManifestDeepLinks,
  ensureAndroidNativeShellIdentity,
  renderManagedMobileFile,
  resolveAndroidSdkDetails,
  resolveInstalledMobileConfig
} from "./mobileShellSupport.js";
import {
  discoverLocalPackageMap,
  resolveLocalRepoRoot
} from "./appCommands/shared.js";

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

function collectDeclaredLocalRepoPackagePaths(packageJson = {}, packageMap = new Map()) {
  const sections = [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.optionalDependencies,
    packageJson?.peerDependencies
  ];
  const collected = [];
  const seen = new Set();

  for (const section of sections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }

    for (const packageName of Object.keys(section)) {
      const normalizedPackageName = String(packageName || "").trim();
      if (!normalizedPackageName.startsWith("@jskit-ai/")) {
        continue;
      }

      const packageDirName = normalizedPackageName.slice("@jskit-ai/".length);
      const sourcePath = packageMap.get(packageDirName);
      if (!sourcePath || seen.has(sourcePath)) {
        continue;
      }

      seen.add(sourcePath);
      collected.push(sourcePath);
    }
  }

  return collected;
}

function collectDeclaredExternalPackageSpecs(packageJson = {}, packageMap = new Map()) {
  const sections = [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.optionalDependencies
  ];
  const collected = [];
  const seen = new Set();

  for (const section of sections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }

    for (const packageName of Object.keys(section).sort((left, right) => left.localeCompare(right))) {
      const normalizedPackageName = String(packageName || "").trim();
      const versionSpec = String(section[packageName] || "").trim();
      if (!normalizedPackageName || !versionSpec) {
        continue;
      }
      if (versionSpec.startsWith("file:") || versionSpec.startsWith("workspace:")) {
        continue;
      }

      if (normalizedPackageName.startsWith("@jskit-ai/")) {
        const packageDirName = normalizedPackageName.slice("@jskit-ai/".length);
        if (packageMap.has(packageDirName)) {
          continue;
        }
      }

      const spec = `${normalizedPackageName}@${versionSpec}`;
      if (seen.has(spec)) {
        continue;
      }
      seen.add(spec);
      collected.push(spec);
    }
  }

  return collected;
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
  dryRun = false
} = {}) {
  const {
    path: pathModule,
    loadAppPackageJson
  } = ctx;
  const repoRoot = await resolveLocalRepoRoot({
    appRoot
  });
  const { packageJson } = await loadAppPackageJson(appRoot);
  const packageScripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};

  if (!repoRoot) {
    await runLocalBinary("npm", ["install"], {
      appRoot,
      stderr,
      stdout,
      pathModule,
      createCliError: ctx.createCliError,
      dryRun
    });
    return;
  }

  const packageMap = await discoverLocalPackageMap(repoRoot);
  const localRepoPackagePaths = collectDeclaredLocalRepoPackagePaths(packageJson, packageMap);
  const externalPackageSpecs = collectDeclaredExternalPackageSpecs(packageJson, packageMap);
  if (localRepoPackagePaths.length < 1 && externalPackageSpecs.length < 1) {
    await runLocalBinary("npm", ["install"], {
      appRoot,
      stderr,
      stdout,
      pathModule,
      createCliError: ctx.createCliError,
      dryRun
    });
    return;
  }

  await runLocalBinary("npm", ["install", "--no-save", ...externalPackageSpecs, ...localRepoPackagePaths], {
    appRoot,
    stderr,
    stdout,
    pathModule,
    createCliError: ctx.createCliError,
    dryRun
  });

  if (Object.prototype.hasOwnProperty.call(packageScripts, "devlinks")) {
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
      dryRun: false
    });
  }
}

async function runMobileAddCapacitorCommand({
  ctx,
  commandAdd,
  appRoot,
  options = {},
  stdout,
  stderr
}) {
  const {
    fileExists,
    path: pathModule,
    loadAppPackageJson
  } = ctx;
  const { packageJson } = await loadAppPackageJson(appRoot);
  const addedConfigStub = await ensureMobileConfigStub({
    ctx,
    appRoot,
    packageJson,
    dryRun: options?.dryRun === true,
    stdout
  });

  if (options?.dryRun === true && addedConfigStub) {
    stdout.write(
      "[dry-run] mobile package install preview stops after the config.mobile stub because rendered Capacitor files depend on those values.\n"
    );
    return 0;
  }

  await commandAdd({
    positional: ["package", CAPACITOR_RUNTIME_PACKAGE_ID],
    options: {
      ...options,
      runNpmInstall: false,
      inlineOptions: {}
    },
    cwd: appRoot,
    io: {
      stdout,
      stderr
    }
  });

  if (options?.dryRun === true) {
    return 0;
  }

  await runMobileAppInstall({
    ctx,
    appRoot,
    stdout,
    stderr,
    dryRun: false
  });

  const androidDirectoryPath = pathModule.join(appRoot, "android");
  if (await fileExists(androidDirectoryPath)) {
    stdout.write("[mobile] android/ already exists. Skipping cap add android.\n");
  } else {
    await runLocalBinary("cap", ["add", "android"], {
      appRoot,
      stderr,
      stdout,
      pathModule,
      createCliError: ctx.createCliError
    });
    stdout.write("[mobile] Added Android shell with Capacitor CLI.\n");
  }

  await ensureAndroidManifestDeepLinks({
    ctx,
    appRoot,
    stdout
  });
  await ensureAndroidNativeShellIdentity({
    ctx,
    appRoot,
    stdout
  });
  return 0;
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

  await runLocalBinary("cap", ["run", "android"], {
    appRoot,
    stderr,
    stdout,
    pathModule,
    createCliError: ctx.createCliError,
    dryRun: options?.dryRun === true
  });

  if (options?.dryRun === true) {
    return 0;
  }

  stdout.write("[mobile] Ran the Android shell via Capacitor.\n");
  return 0;
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
