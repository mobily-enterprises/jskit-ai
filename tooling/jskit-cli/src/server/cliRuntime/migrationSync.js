import { ensureArray, sortStrings } from "../shared/collectionUtils.js";

function packageHasInstallMigrations(packageEntry = {}) {
  if (String(packageEntry?.packageMetadata?.kind || "").trim() !== "runtime") {
    return false;
  }
  return ensureArray(packageEntry?.packageMetadata?.mutations?.files).some((mutation) => {
    const record = mutation && typeof mutation === "object" ? mutation : {};
    return String(record.op || "copy-file").trim() === "install-migration";
  });
}

async function synchronizeInstalledMigrations(ctx = {}, { appRoot = "", check = false } = {}) {
  const {
    applyStatelessPackageMigrations,
    loadInstalledAppPackageRegistry
  } = ctx;
  const packageRegistry = await loadInstalledAppPackageRegistry(appRoot);
  const touchedFiles = new Set();
  const migrationPackageIds = [];

  for (const [packageId, packageEntry] of [...packageRegistry.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (!packageHasInstallMigrations(packageEntry)) {
      continue;
    }
    migrationPackageIds.push(packageId);
    await applyStatelessPackageMigrations({
      packageEntry,
      packageOptions: {},
      appRoot,
      touchedFiles,
      dryRun: check
    });
  }

  return {
    changedFiles: sortStrings([...touchedFiles]),
    migrationPackageIds,
    packageCount: packageRegistry.size
  };
}

export {
  packageHasInstallMigrations,
  synchronizeInstalledMigrations
};
