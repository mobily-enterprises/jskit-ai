import { runLocalJskit, runExternalCommand } from "./shared.js";

function collectJskitPackageNames(packageMap = {}) {
  return Object.keys(packageMap && typeof packageMap === "object" ? packageMap : {})
    .filter((name) => String(name || "").startsWith("@jskit-ai/"))
    .sort((left, right) => left.localeCompare(right));
}

function resolveMajorRangeFromVersion(packageName = "", rawVersion = "", createCliError) {
  const normalizedVersion = String(rawVersion || "").trim();
  const match = normalizedVersion.match(/^(\d+)\.\d+\.\d+(?:[.+-][0-9A-Za-z.-]+)?$/u);
  if (!match) {
    throw createCliError(`Invalid latest version for ${packageName}: ${normalizedVersion || "<empty>"}.`, {
      exitCode: 1
    });
  }
  return `${match[1]}.x`;
}

function resolveRegistryArgs(registryUrl = "") {
  const normalizedRegistryUrl = String(registryUrl || "").trim();
  if (!normalizedRegistryUrl) {
    return [];
  }
  return ["--registry", normalizedRegistryUrl];
}

function resolveInstallSpecs(packageNames = [], resolveMajorRange) {
  return packageNames.map((packageName) => `${packageName}@${resolveMajorRange(packageName)}`);
}

async function runAppUpdatePackagesCommand(ctx = {}, { appRoot = "", options = {}, stdout, stderr }) {
  const {
    createCliError,
    loadAppPackageJson
  } = ctx;

  const { packageJson } = await loadAppPackageJson(appRoot);
  const runtimePackages = collectJskitPackageNames(packageJson?.dependencies);
  const devPackages = collectJskitPackageNames(packageJson?.devDependencies);
  const registryUrl = String(options?.inlineOptions?.registry || "").trim();
  const registryArgs = resolveRegistryArgs(registryUrl);
  const dryRun = options?.dryRun === true;

  if (runtimePackages.length < 1 && devPackages.length < 1) {
    stdout.write("[jskit:update] no @jskit-ai packages found in dependencies.\n");
    return 0;
  }

  const resolveMajorRange = (packageName) => {
    const result = runExternalCommand("npm", ["view", ...registryArgs, packageName, "version"], {
      cwd: appRoot,
      stdout,
      stderr,
      quiet: true,
      createCliError
    });
    return resolveMajorRangeFromVersion(packageName, result.stdout, createCliError);
  };

  const runtimeSpecs = resolveInstallSpecs(runtimePackages, resolveMajorRange);
  const devSpecs = resolveInstallSpecs(devPackages, resolveMajorRange);
  const dryRunArgs = dryRun ? ["--dry-run"] : [];

  if (dryRun) {
    stdout.write("[jskit:update] dry-run mode enabled.\n");
  }

  if (runtimeSpecs.length > 0) {
    stdout.write(`[jskit:update] updating runtime packages: ${runtimeSpecs.join(" ")}\n`);
    runExternalCommand("npm", ["install", "--save-exact", ...registryArgs, ...dryRunArgs, ...runtimeSpecs], {
      cwd: appRoot,
      stdout,
      stderr,
      createCliError
    });
  }

  if (devSpecs.length > 0) {
    stdout.write(`[jskit:update] updating dev packages: ${devSpecs.join(" ")}\n`);
    runExternalCommand("npm", ["install", "--save-dev", "--save-exact", ...registryArgs, ...dryRunArgs, ...devSpecs], {
      cwd: appRoot,
      stdout,
      stderr,
      createCliError
    });
  }

  if (!dryRun) {
    stdout.write("[jskit:update] generating managed migrations for changed packages.\n");
    await runLocalJskit(appRoot, ["migrations", "changed"], {
      stdout,
      stderr,
      createCliError
    });
  }

  stdout.write("[jskit:update] done.\n");
  return 0;
}

export { runAppUpdatePackagesCommand };
