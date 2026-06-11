import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { createCliError } from "../../shared/cliError.js";
import { ensureObject } from "../../shared/collectionUtils.js";
import {
  hashBuffer,
  normalizeMigrationExtension,
  normalizeMigrationId,
  resolveAppRelativePathWithinRoot,
  formatMigrationTimestamp,
  buildManagedMigrationRelativePath,
  findExistingManagedMigrationPathById,
  upsertManagedMigrationRecord,
  fileExists
} from "../ioAndMigrations.js";
import { normalizeRelativePosixPath } from "../localPackageSupport.js";

async function applyInstallMigrationMutation({
  packageEntry,
  preparedMutation,
  appRoot,
  managedMigrations,
  managedMigrationById,
  touchedFiles,
  warnings,
  dryRun = false
} = {}) {
  const mutation = ensureObject(preparedMutation?.mutation);
  if (mutation.preserveOnRemove === true) {
    warnings.push(
      `${packageEntry.packageId}: install-migration ignores preserveOnRemove (migrations are always preserved on remove).`
    );
  }

  const from = mutation.from;
  const toDir = mutation.toDir || "migrations";
  const sourcePath = String(preparedMutation?.sourcePath || "").trim();
  const renderedSourceContent = preparedMutation?.renderedSourceContent;
  if (!from) {
    throw createCliError(`Invalid install-migration mutation in ${packageEntry.packageId}: \"from\" is required.`);
  }
  if (!sourcePath) {
    throw createCliError(`Invalid install-migration mutation in ${packageEntry.packageId}: missing prepared source path.`);
  }
  const migrationId = normalizeMigrationId(mutation.id, packageEntry.packageId);
  if (typeof renderedSourceContent !== "string") {
    throw createCliError(`Invalid install-migration mutation in ${packageEntry.packageId}: missing rendered migration source.`);
  }
  const sourceExtension = normalizeMigrationExtension(path.extname(from), ".cjs");
  const extension = normalizeMigrationExtension(mutation.extension, sourceExtension);
  const sourceHash = hashBuffer(Buffer.from(renderedSourceContent, "utf8"));

  const existingManagedRecord = managedMigrationById.get(migrationId);
  if (existingManagedRecord) {
    const existingManagedPath = normalizeRelativePosixPath(String(existingManagedRecord.path || "").trim());
    if (!existingManagedPath) {
      throw createCliError(
        `${packageEntry.packageId}: managed migration ${migrationId} is missing path in lock.`
      );
    }
    const resolvedManagedPath = resolveAppRelativePathWithinRoot(
      appRoot,
      existingManagedPath,
      `${packageEntry.packageId} managed migration path for ${migrationId}`
    );
    const relativePath = resolvedManagedPath.relativePath;
    const absolutePath = resolvedManagedPath.absolutePath;
    let existingSourceHash = String(existingManagedRecord.hash || "").trim();
    if (!existingSourceHash && existingManagedPath && (await fileExists(absolutePath))) {
      const existingSource = await readFile(absolutePath);
      existingSourceHash = hashBuffer(existingSource);
    }

    if (existingSourceHash && existingSourceHash !== sourceHash) {
      throw createCliError(
        `${packageEntry.packageId}: migration ${migrationId} changed after install. Keep migrations immutable and create a new migration id.`
      );
    }

    if (!(await fileExists(absolutePath))) {
      if (!dryRun) {
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, renderedSourceContent, "utf8");
      }
      touchedFiles.add(relativePath);
    }

    const nextManagedRecord = {
      ...existingManagedRecord,
      id: migrationId,
      path: relativePath,
      hash: sourceHash,
      skipped: true,
      reason: mutation.reason || String(existingManagedRecord.reason || ""),
      category: mutation.category || String(existingManagedRecord.category || "")
    };
    managedMigrationById.set(migrationId, nextManagedRecord);
    upsertManagedMigrationRecord(managedMigrations, nextManagedRecord);
    warnings.push(
      `${packageEntry.packageId}: skipped migration ${migrationId} (already managed at ${nextManagedRecord.path}).`
    );
    return;
  }

  const existingPathById = await findExistingManagedMigrationPathById({
    appRoot,
    toDir,
    packageId: packageEntry.packageId,
    migrationId,
    extension
  });
  if (existingPathById) {
    const existingSource = await readFile(existingPathById.absolutePath);
    const existingSourceHash = hashBuffer(existingSource);
    if (existingSourceHash !== sourceHash) {
      throw createCliError(
        `${packageEntry.packageId}: migration ${migrationId} changed after install. Keep migrations immutable and create a new migration id.`
      );
    }
    const nextManagedRecord = {
      id: migrationId,
      path: existingPathById.relativePath,
      hash: sourceHash,
      skipped: true,
      reason: mutation.reason,
      category: mutation.category
    };
    managedMigrationById.set(migrationId, nextManagedRecord);
    upsertManagedMigrationRecord(managedMigrations, nextManagedRecord);
    warnings.push(
      `${packageEntry.packageId}: skipped migration ${migrationId} (already exists at ${nextManagedRecord.path}).`
    );
    return;
  }

  const baseNowMs = Date.now();
  let targetPath = null;
  for (let secondOffset = 0; secondOffset < 86400; secondOffset += 1) {
    const timestamp = formatMigrationTimestamp(new Date(baseNowMs + secondOffset * 1000));
    const candidateRelativePath = buildManagedMigrationRelativePath({
      toDir,
      packageId: packageEntry.packageId,
      migrationId,
      extension,
      timestamp
    });
    const candidatePath = resolveAppRelativePathWithinRoot(
      appRoot,
      candidateRelativePath,
      `${packageEntry.packageId} migration path for ${migrationId}`
    );
    if (await fileExists(candidatePath.absolutePath)) {
      continue;
    }
    targetPath = candidatePath;
    break;
  }

  if (!targetPath) {
    throw createCliError(
      `${packageEntry.packageId}: unable to allocate migration filename for ${migrationId} in ${toDir}.`
    );
  }

  const relativePath = targetPath.relativePath;
  const absolutePath = targetPath.absolutePath;
  if (!dryRun) {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, renderedSourceContent, "utf8");
  }
  touchedFiles.add(relativePath);

  const nextManagedRecord = {
    id: migrationId,
    path: relativePath,
    hash: sourceHash,
    skipped: false,
    reason: mutation.reason,
    category: mutation.category
  };
  managedMigrationById.set(migrationId, nextManagedRecord);
  upsertManagedMigrationRecord(managedMigrations, nextManagedRecord);
}

export {
  applyInstallMigrationMutation
};
