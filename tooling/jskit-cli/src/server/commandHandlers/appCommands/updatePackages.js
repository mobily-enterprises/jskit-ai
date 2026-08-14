import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import semver from "semver";

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

function parseRegistryPackageManifest(rawValue, packageName, createCliError) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawValue || ""));
  } catch (error) {
    throw createCliError(
      `npm returned invalid metadata for ${packageName}: ${error instanceof Error ? error.message : String(error)}.`,
      { exitCode: 1 }
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createCliError(`npm returned invalid metadata for ${packageName}: expected an object.`, {
      exitCode: 1
    });
  }
  return parsed;
}

async function resolveRegistryPackageManifests(packageNames = [], latestVersions = new Map(), {
  appRoot,
  createCliError,
  registryArgs,
  stderr,
  stdout
}) {
  const manifests = new Map();
  for (const packageName of packageNames) {
    const version = latestVersions.get(packageName);
    const result = await runExternalCommandAsync(
      "npm",
      ["view", ...registryArgs, `${packageName}@${version}`, "--json"],
      {
        cwd: appRoot,
        stdout,
        stderr,
        quiet: true,
        createCliError
      }
    );
    manifests.set(
      packageName,
      parseRegistryPackageManifest(result.stdout, packageName, createCliError)
    );
  }
  return manifests;
}

function resolveDeclaredDependencySection(packageJson = {}, packageName = "") {
  return DEPENDENCY_SECTIONS.find((section) =>
    Object.prototype.hasOwnProperty.call(packageJson?.[section.name] || {}, packageName)
  ) || null;
}

function findRangeIntersectionVersion(ranges = []) {
  const normalizedRanges = ranges
    .map((range) => semver.validRange(String(range || "").trim()))
    .filter(Boolean);
  if (normalizedRanges.length !== ranges.length) {
    return null;
  }

  const candidates = normalizedRanges
    .map((range) => semver.minVersion(range))
    .filter(Boolean)
    .sort(semver.compare);
  return candidates.find((version) =>
    normalizedRanges.every((range) => semver.satisfies(version, range))
  ) || null;
}

function resolveRequiredDirectPeerUpdates({
  createCliError,
  packageJson = {},
  packageManifests = new Map()
} = {}) {
  const requirementsByPeer = new Map();
  for (const [packageName, manifest] of packageManifests.entries()) {
    const peerDependencies = ensureObject(manifest?.peerDependencies);
    const peerDependenciesMeta = ensureObject(manifest?.peerDependenciesMeta);
    for (const [peerName, rawRange] of Object.entries(peerDependencies)) {
      if (ensureObject(peerDependenciesMeta[peerName]).optional === true) {
        continue;
      }
      const section = resolveDeclaredDependencySection(packageJson, peerName);
      if (!section) {
        continue;
      }
      const range = String(rawRange || "").trim();
      if (!semver.validRange(range)) {
        throw createCliError(
          `${packageName} declares an invalid required peer range for ${peerName}: ${range || "<empty>"}.`,
          { exitCode: 1 }
        );
      }
      const requirement = requirementsByPeer.get(peerName) || {
        packageNames: [],
        ranges: [],
        section
      };
      requirement.packageNames.push(packageName);
      requirement.ranges.push(range);
      requirementsByPeer.set(peerName, requirement);
    }
  }

  const updates = [];
  for (const [peerName, requirement] of [...requirementsByPeer.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const uniqueRanges = [...new Set(requirement.ranges)];
    const targetVersion = findRangeIntersectionVersion(uniqueRanges);
    if (!targetVersion) {
      throw createCliError(
        `Updated JSKIT packages require incompatible ${peerName} peers: ${uniqueRanges.join(", ")}.`,
        { exitCode: 1 }
      );
    }

    const currentRange = String(packageJson?.[requirement.section.name]?.[peerName] || "").trim();
    if (findRangeIntersectionVersion([currentRange, ...uniqueRanges])) {
      continue;
    }

    const subsetRange = uniqueRanges.find((candidateRange) =>
      uniqueRanges.every((otherRange) => semver.subset(candidateRange, otherRange))
    );
    updates.push(Object.freeze({
      name: peerName,
      packageNames: Object.freeze([...new Set(requirement.packageNames)].sort()),
      previousRange: currentRange,
      section: requirement.section,
      targetRange: subsetRange || targetVersion.version
    }));
  }

  return Object.freeze(updates);
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

function collectJskitMutationPackageNames(packageJson = {}) {
  const dependencyMutations = ensureObject(ensureObject(packageJson.jskit).mutations?.dependencies);
  return sortStrings([
    ...new Set([
      ...collectJskitPackageNames(dependencyMutations.runtime),
      ...collectJskitPackageNames(dependencyMutations.dev)
    ])
  ]);
}

async function loadWorkspacePackages(workspaceDirectories = []) {
  const workspacePackages = [];
  for (const directory of workspaceDirectories) {
    const packageJsonPath = path.join(directory, "package.json");
    workspacePackages.push({
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
      const targetVersion = resolveExactVersion(packageName, latestVersions.get(packageName), createCliError);
      if (packageMap[packageName] === targetVersion) {
        continue;
      }
      packageMap[packageName] = targetVersion;
      updates.push(`${packageName}@${targetVersion}`);
    }
  }
  const dependencyMutations = ensureObject(ensureObject(packageJson.jskit).mutations?.dependencies);
  for (const mutationSection of ["runtime", "dev"]) {
    const packageMap = ensureObject(dependencyMutations[mutationSection]);
    for (const packageName of collectJskitPackageNames(packageMap)) {
      const targetVersion = resolveExactVersion(packageName, latestVersions.get(packageName), createCliError);
      const currentValue = packageMap[packageName];
      if (typeof currentValue === "string") {
        if (currentValue !== targetVersion) {
          packageMap[packageName] = targetVersion;
          updates.push(`jskit.mutations.dependencies.${mutationSection}.${packageName}@${targetVersion}`);
        }
        continue;
      }
      const record = ensureObject(currentValue);
      const versionField = Object.prototype.hasOwnProperty.call(record, "version")
        ? "version"
        : Object.prototype.hasOwnProperty.call(record, "value")
          ? "value"
          : "";
      if (versionField && record[versionField] !== targetVersion) {
        record[versionField] = targetVersion;
        updates.push(`jskit.mutations.dependencies.${mutationSection}.${packageName}@${targetVersion}`);
      }
    }
  }
  return updates;
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
    for (const packageName of collectJskitMutationPackageNames(workspacePackage.packageJson)) {
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
    if (manifestUpdates.length < 1) {
      continue;
    }
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
  const packageManifests = await resolveRegistryPackageManifests(
    rootPackageNames,
    latestVersions,
    {
      appRoot,
      createCliError,
      registryArgs,
      stderr,
      stdout
    }
  );
  const peerUpdates = resolveRequiredDirectPeerUpdates({
    createCliError,
    packageJson,
    packageManifests
  });
  for (const peerUpdate of peerUpdates) {
    stdout?.write(
      `[jskit:update] reconciling required direct peer ${peerUpdate.name}: ` +
      `${peerUpdate.previousRange} -> ${peerUpdate.targetRange} ` +
      `(required by ${peerUpdate.packageNames.join(", ")}).\n`
    );
    packageJson[peerUpdate.section.name][peerUpdate.name] = peerUpdate.targetRange;
  }
  if (!dryRun && peerUpdates.length > 0) {
    await writeFile(
      path.join(appRoot, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf8"
    );
  }

  const dryRunArgs = dryRun ? ["--dry-run"] : [];
  for (const section of DEPENDENCY_SECTIONS) {
    const packageNames = collectJskitPackageNames(packageJson?.[section.name]);
    const dryRunPeerSpecs = dryRun
      ? peerUpdates
          .filter((peerUpdate) => peerUpdate.section.name === section.name)
          .map((peerUpdate) => `${peerUpdate.name}@${peerUpdate.targetRange}`)
      : [];
    if (packageNames.length < 1 && dryRunPeerSpecs.length < 1) {
      continue;
    }
    const installSpecs = [
      ...resolveInstallSpecs(packageNames, latestVersions),
      ...dryRunPeerSpecs
    ];
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

async function assertRootJskitVersionsAreExact({
  appRoot,
  createCliError,
  latestVersions
}) {
  const packageJson = await readJson(path.join(appRoot, "package.json"));
  const mismatches = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const packageMap = ensureObject(packageJson[section.name]);
    for (const packageName of collectJskitPackageNames(packageMap)) {
      const expectedVersion = latestVersions.get(packageName);
      if (expectedVersion && String(packageMap[packageName] || "").trim() !== expectedVersion) {
        mismatches.push(
          `${section.name}.${packageName}=${String(packageMap[packageName] || "").trim()} (expected ${expectedVersion})`
        );
      }
    }
  }
  if (mismatches.length > 0) {
    throw createCliError(
      `npm did not preserve exact root JSKIT versions: ${mismatches.join(", ")}.`,
      { exitCode: 1 }
    );
  }
}

async function runAppUpdatePackagesCommand(ctx = {}, { appRoot = "", options = {}, stdout, stderr }) {
  const {
    createCliError,
    loadAppPackageJson,
    assertAppCiCanSynchronize
  } = ctx;

  await assertAppCiCanSynchronize({ appRoot });
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
      await updateRootPackages({
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
      activity: dryRun
        ? "checking root JSKIT package updates"
        : "installing exact root JSKIT package versions",
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
      activity: "aligning exact JSKIT versions in workspace manifests",
      stdout,
      step: "Step 2/3"
    }
  );
  stdout?.write(
    `[jskit:update] Step 2/3 summary: ${workspaceResult.changedFiles.length} workspace files ${dryRun ? "would change" : "changed"}.\n`
  );

  if (dryRun) {
    stdout?.write(
      `[jskit:update] Step 3/3 skipped in dry-run mode: npm install, migration sync, and CI sync were not run.\n`
    );
  } else {
    await runWithProgress(
      async () => {
        if (workspaceResult.packageNames.length > 0) {
          await runExternalCommandAsync(
            "npm",
            ["install", ...registryArgs],
            {
              cwd: appRoot,
              stdout,
              stderr,
              createCliError
            }
          );
        }
        await assertRootJskitVersionsAreExact({
          appRoot,
          createCliError,
          latestVersions
        });
        await runLocalJskitAsync(appRoot, ["migrations", "sync"], {
          stdout,
          stderr,
          createCliError
        });
        await runLocalJskitAsync(appRoot, ["ci", "generate"], {
          stdout,
          stderr,
          createCliError
        });
      },
      {
        activity: "refreshing npm resolution and synchronizing generated migrations and CI",
        stdout,
        step: "Step 3/3"
      }
    );
  }

  stdout?.write("[jskit:update] done.\n");
  return 0;
}

export {
  findRangeIntersectionVersion,
  formatElapsedTime,
  resolveRequiredDirectPeerUpdates,
  runAppUpdatePackagesCommand,
  runWithProgress
};
