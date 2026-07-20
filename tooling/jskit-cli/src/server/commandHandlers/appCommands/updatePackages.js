import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  runExternalCommandAsync,
  runLocalJskitAsync
} from "./shared.js";
import {
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";

const DEPENDENCY_SECTIONS = Object.freeze([
  Object.freeze({
    installArgs: Object.freeze(["--save-exact"]),
    label: "runtime",
    name: "dependencies"
  }),
  Object.freeze({
    installArgs: Object.freeze(["--save-dev", "--save-exact"]),
    label: "development",
    name: "devDependencies"
  }),
  Object.freeze({
    installArgs: Object.freeze(["--save-optional", "--save-exact"]),
    label: "optional",
    name: "optionalDependencies"
  }),
  Object.freeze({
    installArgs: Object.freeze(["--save-peer", "--save-exact"]),
    label: "peer",
    name: "peerDependencies"
  })
]);
const JSKIT_PACKAGE_PATTERN = /^@jskit-ai\/[a-z0-9._-]+$/iu;
const PROGRESS_INTERVAL_MS = 5_000;

function collectJskitPackageNames(packageMap = {}) {
  return sortStrings(
    Object.keys(packageMap && typeof packageMap === "object" ? packageMap : {})
      .filter((name) => JSKIT_PACKAGE_PATTERN.test(String(name || "")))
  );
}

function collectManifestJskitPackageNames(packageJson = {}) {
  const packageNames = new Set();
  for (const section of DEPENDENCY_SECTIONS) {
    for (const packageName of collectJskitPackageNames(packageJson?.[section.name])) {
      packageNames.add(packageName);
    }
  }
  return sortStrings([...packageNames]);
}

function resolveExactVersion(packageName = "", rawVersion = "", createCliError) {
  const normalizedVersion = String(rawVersion || "").trim();
  if (!/^\d+\.\d+\.\d+(?:[.+-][0-9A-Za-z.-]+)?$/u.test(normalizedVersion)) {
    throw createCliError(`Invalid latest version for ${packageName}: ${normalizedVersion || "<empty>"}.`, {
      exitCode: 1
    });
  }
  return normalizedVersion;
}

function resolveMajorRange(packageName = "", version = "", createCliError) {
  const exactVersion = resolveExactVersion(packageName, version, createCliError);
  return `${exactVersion.slice(0, exactVersion.indexOf("."))}.x`;
}

function resolveRegistryArgs(registryUrl = "") {
  const normalizedRegistryUrl = String(registryUrl || "").trim();
  if (!normalizedRegistryUrl) {
    return [];
  }
  return ["--registry", normalizedRegistryUrl];
}

function resolveInstallSpecs(packageNames = [], latestVersions = new Map()) {
  return packageNames.map((packageName) => `${packageName}@${latestVersions.get(packageName)}`);
}

function collectChangedInstalledPackageIds(lock = {}, latestVersions = new Map()) {
  const installedPackages = ensureObject(lock.installedPackages);
  return sortStrings(
    [...latestVersions.entries()]
      .filter(([packageId, targetVersion]) => {
        if (!Object.prototype.hasOwnProperty.call(installedPackages, packageId)) {
          return false;
        }
        const installedPackage = ensureObject(installedPackages[packageId]);
        return String(installedPackage.version || "").trim() !== targetVersion;
      })
      .map(([packageId]) => packageId)
  );
}

async function reapplyChangedInstalledPackages({
  appRoot,
  createCliError,
  dryRun,
  latestVersions,
  loadLockFile,
  stderr,
  stdout
}) {
  const { lock } = await loadLockFile(appRoot);
  const packageIds = collectChangedInstalledPackageIds(lock, latestVersions);
  if (packageIds.length < 1) {
    stdout?.write("[jskit:update] managed package state is already current.\n");
    return;
  }

  stdout?.write(`[jskit:update] managed packages requiring reapply: ${packageIds.join(", ")}.\n`);
  if (dryRun) {
    return;
  }

  for (const [index, packageId] of packageIds.entries()) {
    const { lock: currentLock } = await loadLockFile(appRoot);
    const currentVersion = String(
      ensureObject(ensureObject(currentLock.installedPackages)[packageId]).version || ""
    ).trim();
    if (currentVersion === latestVersions.get(packageId)) {
      continue;
    }
    stdout?.write(
      `[jskit:update] reapplying managed package ${index + 1}/${packageIds.length}: ${packageId}.\n`
    );
    await runLocalJskitAsync(appRoot, ["update", "package", packageId], {
      stdout,
      stderr,
      createCliError
    });
  }

  const { lock: updatedLock } = await loadLockFile(appRoot);
  const remainingPackageIds = collectChangedInstalledPackageIds(updatedLock, latestVersions);
  if (remainingPackageIds.length > 0) {
    throw createCliError(
      `Managed package reapply finished with stale lock versions: ${remainingPackageIds.join(", ")}.`
    );
  }
  stdout?.write("[jskit:update] managed package state is current.\n");
}

function formatElapsedTime(elapsedMilliseconds = 0) {
  const elapsedSeconds = Math.max(0, Math.floor(Number(elapsedMilliseconds) / 1000));
  if (elapsedSeconds < 1) {
    return "under 1s";
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

async function runWithProgress(task, {
  activity,
  progressIntervalMs = PROGRESS_INTERVAL_MS,
  stdout,
  step
} = {}) {
  const normalizedActivity = String(activity || "running update").trim();
  const normalizedStep = String(step || "Update").trim();
  const startedAt = Date.now();
  stdout?.write(`[jskit:update] ${normalizedStep}: ${normalizedActivity}.\n`);

  const progressTimer = setInterval(() => {
    stdout?.write(
      `[jskit:update] ${normalizedStep} is still running (${formatElapsedTime(Date.now() - startedAt)} elapsed): ${normalizedActivity}.\n`
    );
  }, progressIntervalMs);
  progressTimer.unref();

  try {
    const result = await task();
    stdout?.write(
      `[jskit:update] ${normalizedStep} complete in ${formatElapsedTime(Date.now() - startedAt)}.\n`
    );
    return result;
  } finally {
    clearInterval(progressTimer);
  }
}

function hasNpmWorkspaces(packageJson = {}) {
  const workspaces = Array.isArray(packageJson?.workspaces)
    ? packageJson.workspaces
    : packageJson?.workspaces?.packages;
  return Array.isArray(workspaces) && workspaces.some((workspace) => String(workspace || "").trim());
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function resolveWorkspaceDirectories({
  appRoot,
  createCliError,
  packageJson,
  stderr,
  stdout
}) {
  if (!hasNpmWorkspaces(packageJson)) {
    return [];
  }

  const result = await runExternalCommandAsync("npm", ["query", ".workspace", "--json"], {
    cwd: appRoot,
    stdout,
    stderr,
    quiet: true,
    createCliError
  });

  let entries;
  try {
    entries = JSON.parse(String(result.stdout || "[]"));
  } catch (error) {
    throw createCliError(`npm returned invalid workspace metadata: ${error instanceof Error ? error.message : String(error)}.`, {
      exitCode: 1
    });
  }
  if (!Array.isArray(entries)) {
    throw createCliError("npm returned invalid workspace metadata: expected a JSON array.", {
      exitCode: 1
    });
  }

  const normalizedAppRoot = path.resolve(appRoot);
  const workspaceDirectories = new Set();
  for (const entry of entries) {
    const location = String(entry?.location || "").trim();
    if (!location) {
      continue;
    }
    const workspaceDirectory = path.resolve(normalizedAppRoot, location);
    if (
      workspaceDirectory === normalizedAppRoot ||
      !workspaceDirectory.startsWith(`${normalizedAppRoot}${path.sep}`)
    ) {
      throw createCliError(`npm returned a workspace outside the app root: ${location}.`, {
        exitCode: 1
      });
    }
    workspaceDirectories.add(workspaceDirectory);
  }

  return [...workspaceDirectories].sort((left, right) => left.localeCompare(right));
}

function descriptorJskitPackageNames(source = "") {
  const packageNames = new Set();
  const patterns = [
    /(["'])(@jskit-ai\/[a-z0-9._-]+)\1\s*:\s*(["'])[^"']+\3/giu,
    /(["'])(@jskit-ai\/[a-z0-9._-]+)\1\s*:\s*\{[^{}]*?(?:["'](?:version|value)["']|version|value)\s*:\s*(["'])[^"']+\3/giu
  ];
  for (const pattern of patterns) {
    for (const match of String(source || "").matchAll(pattern)) {
      packageNames.add(match[2]);
    }
  }
  return [...packageNames].sort((left, right) => left.localeCompare(right));
}

async function loadWorkspacePackages(workspaceDirectories = []) {
  const workspacePackages = [];
  for (const directory of workspaceDirectories) {
    const packageJsonPath = path.join(directory, "package.json");
    const descriptorPath = path.join(directory, "package.descriptor.mjs");
    workspacePackages.push({
      descriptorPath,
      descriptorSource: await readOptionalFile(descriptorPath),
      directory,
      packageJson: await readJson(packageJsonPath),
      packageJsonPath
    });
  }
  return workspacePackages;
}

async function resolveLatestVersions(packageNames = [], latestVersions = new Map(), {
  appRoot,
  createCliError,
  registryArgs,
  stderr,
  stdout
}) {
  const unresolvedPackageNames = packageNames
    .filter((packageName) => !latestVersions.has(packageName))
    .sort((left, right) => left.localeCompare(right));

  for (const [index, packageName] of unresolvedPackageNames.entries()) {
    stdout?.write(
      `[jskit:update] resolving latest package ${index + 1}/${unresolvedPackageNames.length}: ${packageName}.\n`
    );
    const result = await runExternalCommandAsync(
      "npm",
      ["view", ...registryArgs, packageName, "version"],
      {
        cwd: appRoot,
        stdout,
        stderr,
        quiet: true,
        createCliError
      }
    );
    const version = resolveExactVersion(packageName, result.stdout, createCliError);
    latestVersions.set(packageName, version);
    stdout?.write(`[jskit:update] resolved ${packageName}@${version}.\n`);
  }

  return latestVersions;
}

function updateWorkspaceManifest(packageJson = {}, latestVersions = new Map(), createCliError) {
  const updates = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const packageMap = packageJson?.[section.name];
    for (const packageName of collectJskitPackageNames(packageMap)) {
      const targetRange = resolveMajorRange(packageName, latestVersions.get(packageName), createCliError);
      if (packageMap[packageName] === targetRange) {
        continue;
      }
      packageMap[packageName] = targetRange;
      updates.push(`${packageName}@${targetRange}`);
    }
  }
  return updates;
}

function updateWorkspaceDescriptor(source = "", latestVersions = new Map(), createCliError) {
  const updates = [];
  const replaceVersion = (match, keyQuote, packageName, separator, valueQuote, currentVersion) => {
    const targetRange = resolveMajorRange(packageName, latestVersions.get(packageName), createCliError);
    if (currentVersion === targetRange) {
      return match;
    }
    updates.push(`${packageName}@${targetRange}`);
    return `${keyQuote}${packageName}${keyQuote}${separator}${valueQuote}${targetRange}${valueQuote}`;
  };
  let nextSource = String(source || "").replace(
    /(["'])(@jskit-ai\/[a-z0-9._-]+)\1(\s*:\s*)(["'])([^"']+)\4/giu,
    replaceVersion
  );
  nextSource = nextSource.replace(
    /(["'])(@jskit-ai\/[a-z0-9._-]+)\1(\s*:\s*\{[^{}]*?(?:["'](?:version|value)["']|version|value)\s*:\s*)(["'])([^"']+)\4/giu,
    replaceVersion
  );
  return {
    nextSource,
    updates
  };
}

async function synchronizeWorkspacePackageSpecs({
  appRoot,
  createCliError,
  dryRun,
  latestVersions,
  packageJson,
  registryArgs,
  stderr,
  stdout
}) {
  const workspaceDirectories = await resolveWorkspaceDirectories({
    appRoot,
    createCliError,
    packageJson,
    stderr,
    stdout
  });
  const workspacePackages = await loadWorkspacePackages(workspaceDirectories);
  const workspaceJskitPackages = new Set();
  for (const workspacePackage of workspacePackages) {
    for (const packageName of collectManifestJskitPackageNames(workspacePackage.packageJson)) {
      workspaceJskitPackages.add(packageName);
    }
    for (const packageName of descriptorJskitPackageNames(workspacePackage.descriptorSource)) {
      workspaceJskitPackages.add(packageName);
    }
  }

  const packageNames = [...workspaceJskitPackages].sort((left, right) => left.localeCompare(right));
  await resolveLatestVersions(packageNames, latestVersions, {
    appRoot,
    createCliError,
    registryArgs,
    stderr,
    stdout
  });

  const changedFiles = [];
  for (const workspacePackage of workspacePackages) {
    const manifestUpdates = updateWorkspaceManifest(
      workspacePackage.packageJson,
      latestVersions,
      createCliError
    );
    if (manifestUpdates.length > 0) {
      const relativePath = path.relative(appRoot, workspacePackage.packageJsonPath).replaceAll(path.sep, "/");
      changedFiles.push(relativePath);
      stdout?.write(`[jskit:update] workspace manifest ${relativePath} -> ${manifestUpdates.join(", ")}\n`);
      if (!dryRun) {
        await writeFile(
          workspacePackage.packageJsonPath,
          `${JSON.stringify(workspacePackage.packageJson, null, 2)}\n`,
          "utf8"
        );
      }
    }

    if (!workspacePackage.descriptorSource) {
      continue;
    }
    const descriptorResult = updateWorkspaceDescriptor(
      workspacePackage.descriptorSource,
      latestVersions,
      createCliError
    );
    if (descriptorResult.updates.length < 1) {
      continue;
    }
    const relativePath = path.relative(appRoot, workspacePackage.descriptorPath).replaceAll(path.sep, "/");
    changedFiles.push(relativePath);
    stdout?.write(`[jskit:update] workspace descriptor ${relativePath} -> ${descriptorResult.updates.join(", ")}\n`);
    if (!dryRun) {
      await writeFile(workspacePackage.descriptorPath, descriptorResult.nextSource, "utf8");
    }
  }

  return {
    changedFiles,
    packageNames
  };
}

async function updateRootPackages({
  appRoot,
  createCliError,
  dryRun,
  latestVersions,
  packageJson,
  registryArgs,
  stderr,
  stdout
}) {
  const rootPackageNames = collectManifestJskitPackageNames(packageJson);
  if (rootPackageNames.length < 1) {
    stdout?.write("[jskit:update] no root @jskit-ai packages found.\n");
    return false;
  }

  await resolveLatestVersions(rootPackageNames, latestVersions, {
    appRoot,
    createCliError,
    registryArgs,
    stderr,
    stdout
  });
  const dryRunArgs = dryRun ? ["--dry-run"] : [];
  for (const section of DEPENDENCY_SECTIONS) {
    const packageNames = collectJskitPackageNames(packageJson?.[section.name]);
    if (packageNames.length < 1) {
      continue;
    }
    const installSpecs = resolveInstallSpecs(packageNames, latestVersions);
    stdout?.write(`[jskit:update] updating ${section.label} packages: ${installSpecs.join(" ")}\n`);
    await runExternalCommandAsync(
      "npm",
      ["install", ...section.installArgs, ...registryArgs, ...dryRunArgs, ...installSpecs],
      {
        cwd: appRoot,
        stdout,
        stderr,
        createCliError
      }
    );
  }
  return true;
}

async function runAppUpdatePackagesCommand(ctx = {}, { appRoot = "", options = {}, stdout, stderr }) {
  const {
    createCliError,
    loadAppPackageJson,
    loadLockFile,
    assertAppManagedCiWorkflowUnmodified
  } = ctx;

  await assertAppManagedCiWorkflowUnmodified({ appRoot });
  const { packageJson } = await loadAppPackageJson(appRoot);
  const registryUrl = String(options?.inlineOptions?.registry || "").trim();
  const registryArgs = resolveRegistryArgs(registryUrl);
  const dryRun = options?.dryRun === true;
  const latestVersions = new Map();

  if (dryRun) {
    stdout?.write("[jskit:update] dry-run mode enabled.\n");
  }

  await runWithProgress(
    async () => {
      const updatedRootPackages = await updateRootPackages({
        appRoot,
        createCliError,
        dryRun,
        latestVersions,
        packageJson,
        registryArgs,
        stderr,
        stdout
      });
      if (!updatedRootPackages) {
        return;
      }
      await reapplyChangedInstalledPackages({
        appRoot,
        createCliError,
        dryRun,
        latestVersions,
        loadLockFile,
        stderr,
        stdout
      });
      if (dryRun) {
        return;
      }
      stdout?.write("[jskit:update] generating managed migrations for changed packages.\n");
      await runLocalJskitAsync(appRoot, ["migrations", "changed"], {
        stdout,
        stderr,
        createCliError
      });
      stdout?.write("[jskit:update] synchronizing the managed CI workflow.\n");
      await runLocalJskitAsync(appRoot, ["app", "sync-ci"], {
        stdout,
        stderr,
        createCliError
      });
    },
    {
      activity: dryRun
        ? "checking root JSKIT package updates"
        : "updating root JSKIT packages and managed artifacts",
      stdout,
      step: "Step 1/3"
    }
  );

  let workspaceResult = {
    changedFiles: [],
    packageNames: []
  };
  await runWithProgress(
    async () => {
      workspaceResult = await synchronizeWorkspacePackageSpecs({
        appRoot,
        createCliError,
        dryRun,
        latestVersions,
        packageJson,
        registryArgs,
        stderr,
        stdout
      });
    },
    {
      activity: "aligning JSKIT ranges in workspace manifests and descriptors",
      stdout,
      step: "Step 2/3"
    }
  );
  stdout?.write(
    `[jskit:update] Step 2/3 summary: ${workspaceResult.changedFiles.length} workspace files ${dryRun ? "would change" : "changed"}.\n`
  );

  if (dryRun) {
    stdout?.write(
      `[jskit:update] Step 3/3 skipped in dry-run mode: ${workspaceResult.packageNames.length} workspace JSKIT packages would be refreshed.\n`
    );
  } else if (workspaceResult.packageNames.length > 0) {
    await runWithProgress(
      () => runExternalCommandAsync(
        "npm",
        ["update", ...registryArgs, "--workspaces", ...workspaceResult.packageNames],
        {
          cwd: appRoot,
          stdout,
          stderr,
          createCliError
        }
      ),
      {
        activity: `refreshing ${workspaceResult.packageNames.length} workspace JSKIT packages and updating the lockfile`,
        stdout,
        step: "Step 3/3"
      }
    );
  } else {
    stdout?.write("[jskit:update] Step 3/3 skipped: no workspace JSKIT packages were found.\n");
  }

  stdout?.write("[jskit:update] done.\n");
  return 0;
}

export {
  collectChangedInstalledPackageIds,
  formatElapsedTime,
  reapplyChangedInstalledPackages,
  runAppUpdatePackagesCommand,
  runWithProgress
};
