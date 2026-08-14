import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";

function createMigrationTemplate({ packageId, migrationId } = {}) {
  return `/**
 * Package-owned additive migration: ${migrationId}
 * Owner: ${packageId}
 *
 * Implement this source before running jskit migrations sync. Applied
 * migrations are immutable; later schema changes require a new migration.
 */
exports.up = async function up(knex) {
  void knex;
  throw new Error("Implement migration ${migrationId} before synchronizing it.");
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Implement rollback ${migrationId} before synchronizing it.");
};
`;
}

async function runMigrationCreateCommand(ctx = {}, { options, cwd, io }) {
  const {
    createCliError,
    fileExists,
    loadAppLocalPackageRegistry,
    loadInstalledAppPackageRegistry,
    installedPackageRecordFromRegistry,
    mkdir,
    normalizeMigrationId,
    normalizeRelativePath,
    normalizeRelativePosixPath,
    path,
    resolveAppRootFromCwd,
    resolveInstalledPackageIdInput,
    rm,
    writeFile,
    writeJsonFile
  } = ctx;
  const inlineOptions = ensureObject(options.inlineOptions);
  const unsupportedOptions = ["scope", "package-id", "description"].filter((optionName) =>
    Object.prototype.hasOwnProperty.call(inlineOptions, optionName)
  );
  if (unsupportedOptions.length > 0) {
    throw createCliError(
      `Unknown option${unsupportedOptions.length === 1 ? "" : "s"} for create migration: ${unsupportedOptions.map((optionName) => `--${optionName}`).join(", ")}.`
    );
  }

  const requestedPackageId = String(inlineOptions.package || "").trim();
  const rawMigrationId = String(inlineOptions.id || "").trim();
  if (!requestedPackageId || !rawMigrationId) {
    throw createCliError(
      "create migration requires: create migration --package <app-local-package-id> --id <migration-id>",
      { showUsage: true }
    );
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const installedPackages = installedPackageRecordFromRegistry(
    await loadInstalledAppPackageRegistry(appRoot)
  );
  const packageId = resolveInstalledPackageIdInput(requestedPackageId, installedPackages);
  if (!packageId) {
    throw createCliError(`Package is not installed: ${requestedPackageId}`);
  }

  const packageEntry = (await loadAppLocalPackageRegistry(appRoot)).get(packageId);
  if (!packageEntry) {
    throw createCliError(`Migration owner must be an app-local package under packages/: ${packageId}`);
  }

  const migrationId = normalizeMigrationId(rawMigrationId, packageId);
  const packageJson = structuredClone(packageEntry.packageJson);
  const files = ensureArray(packageJson?.jskit?.mutations?.files);
  if (!Array.isArray(packageJson?.jskit?.mutations?.files)) {
    throw createCliError(
      `${normalizeRelativePath(appRoot, path.join(packageEntry.rootDir, "package.json"))} must declare jskit.mutations.files as an array before creating a migration.`
    );
  }
  if (files.some((value) => String(ensureObject(value).id || "").trim() === migrationId)) {
    throw createCliError(
      `${packageId} already declares a file mutation with id ${migrationId}. Use a new immutable migration id.`
    );
  }

  const migrationFrom = `templates/migrations/${migrationId}.cjs`;
  const migrationPath = path.join(packageEntry.rootDir, ...migrationFrom.split("/"));
  const manifestPath = path.join(packageEntry.rootDir, "package.json");
  if (await fileExists(migrationPath)) {
    throw createCliError(`Migration source already exists: ${normalizeRelativePath(appRoot, migrationPath)}`);
  }

  files.push({
    op: "install-migration",
    from: migrationFrom,
    toDir: "migrations",
    extension: ".cjs",
    reason: `Apply package-owned additive schema evolution ${migrationId}.`,
    category: "schema-evolution",
    id: migrationId
  });

  const touchedFiles = sortStrings([
    normalizeRelativePosixPath(normalizeRelativePath(appRoot, manifestPath)),
    normalizeRelativePosixPath(normalizeRelativePath(appRoot, migrationPath))
  ]);

  if (!options.dryRun) {
    await mkdir(path.dirname(migrationPath), { recursive: true });
    await writeFile(migrationPath, createMigrationTemplate({ packageId, migrationId }), {
      encoding: "utf8",
      flag: "wx"
    });
    try {
      await writeJsonFile(manifestPath, packageJson);
    } catch (error) {
      await rm(migrationPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      targetType: "migration",
      packageId,
      migrationId,
      templatePath: normalizeRelativePosixPath(normalizeRelativePath(appRoot, migrationPath)),
      manifestPath: normalizeRelativePosixPath(normalizeRelativePath(appRoot, manifestPath)),
      touchedFiles,
      dryRun: options.dryRun
    }, null, 2)}\n`);
  } else {
    io.stdout.write(`Created package-owned migration source ${migrationId} for ${packageId}.\n`);
    io.stdout.write(`Template: ${normalizeRelativePath(appRoot, migrationPath)}\n`);
    io.stdout.write(`Manifest: ${normalizeRelativePath(appRoot, manifestPath)}\n`);
    io.stdout.write("Implement and test the template, then run: npx jskit migrations sync\n");
    if (options.dryRun) {
      io.stdout.write("Dry run enabled: no files were written.\n");
    }
  }

  return 0;
}

export {
  createMigrationTemplate,
  runMigrationCreateCommand
};
