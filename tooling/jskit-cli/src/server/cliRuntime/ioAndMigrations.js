import { createHash } from "node:crypto";
import {
  access,
  constants as fsConstants,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCliError } from "../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../shared/collectionUtils.js";
import { normalizeFileMutationRecord } from "./mutationWhen.js";

const PUBLIC_APP_CONFIG_RELATIVE_PATH = "config/public.js";
const SERVER_APP_CONFIG_RELATIVE_PATH = "config/server.js";
const MIGRATION_ID_PATTERN = /^[a-z0-9._-]+$/;

function normalizeRelativePosixPath(pathValue) {
  return String(pathValue || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

function buildFileWriteGroups(fileMutations, { packageId = "" } = {}) {
  const groups = [];
  const groupsByKey = new Map();

  for (const mutation of ensureArray(fileMutations)) {
    const normalized = normalizeFileMutationRecord(mutation);
    if (normalized.op === "install-migration") {
      if (!normalized.from || !normalized.id) {
        continue;
      }
    } else if (!normalized.from || (!normalized.to && !normalized.toSurface)) {
      continue;
    }

    const destinationLabel = normalized.to
      ? normalized.to
      : normalized.toSurfaceRoot
        ? `surface:${normalized.toSurface}.root`
        : `surface:${normalized.toSurface}/${normalized.toSurfacePath}`;

    const key = normalized.id
      ? `id:${normalized.id}`
      : normalized.category || normalized.reason
        ? `meta:${normalized.category}::${normalized.reason}`
        : `path:${destinationLabel}`;

    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        id: normalized.id,
        category: normalized.category,
        reason: normalized.reason,
        files: []
      };
      groupsByKey.set(key, group);
      groups.push(group);
    } else {
      if (!group.category && normalized.category) {
        group.category = normalized.category;
      }
      if (!group.reason && normalized.reason) {
        group.reason = normalized.reason;
      }
    }

    if (normalized.op === "install-migration") {
      const toDir = normalized.toDir || "migrations";
      const extension = normalized.extension || ".cjs";
      group.files.push({
        from: normalized.from,
        to: buildManagedMigrationRelativePathLabel({
          toDir,
          packageId,
          migrationId: normalized.id,
          extension
        })
      });
      continue;
    }

    group.files.push({
      from: normalized.from,
      to: destinationLabel
    });
  }

  return groups;
}

function normalizeRelativePath(fromRoot, absolutePath) {
  return path.relative(fromRoot, absolutePath).split(path.sep).join("/");
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeMigrationExtension(value = "", fallback = ".cjs") {
  const normalizedFallback = String(fallback || ".cjs").trim() || ".cjs";
  const raw = String(value || "").trim();
  const candidate = raw ? (raw.startsWith(".") ? raw : `.${raw}`) : normalizedFallback;
  if (!/^\.[a-z0-9]+$/i.test(candidate)) {
    throw createCliError(`Invalid install-migration extension: ${candidate}`);
  }
  return candidate.toLowerCase();
}

function normalizeMigrationId(value, packageId) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw createCliError(`Invalid install-migration mutation in ${packageId}: \"id\" is required.`);
  }
  if (!MIGRATION_ID_PATTERN.test(normalized)) {
    throw createCliError(
      `Invalid install-migration mutation in ${packageId}: "id" must match ${MIGRATION_ID_PATTERN.source}.`
    );
  }
  return normalized;
}

function resolveAppRelativePathWithinRoot(appRoot, relativePath, contextLabel = "path") {
  const normalized = normalizeRelativePosixPath(String(relativePath || "").trim());
  if (!normalized) {
    throw createCliError(`Invalid ${contextLabel}: path is required.`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw createCliError(`Invalid ${contextLabel}: path must be a safe relative path.`);
  }

  const appRootAbsolute = path.resolve(appRoot);
  const absolutePath = path.resolve(appRootAbsolute, normalized);
  const relativeFromRoot = path.relative(appRootAbsolute, absolutePath);
  if (
    relativeFromRoot === ".." ||
    relativeFromRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeFromRoot)
  ) {
    throw createCliError(`Invalid ${contextLabel}: path must stay within app root.`);
  }

  return {
    relativePath: normalized,
    absolutePath
  };
}

function normalizeMigrationDirectory(value, packageId) {
  const normalized = normalizeRelativePosixPath(String(value || "").trim() || "migrations");
  if (!normalized) {
    throw createCliError(`Invalid install-migration mutation in ${packageId}: "toDir" cannot be empty.`);
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw createCliError(`Invalid install-migration mutation in ${packageId}: "toDir" must be a safe relative path.`);
  }

  return segments.join("/");
}

function formatMigrationTimestamp(date = new Date()) {
  const source = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = String(source.getUTCFullYear()).padStart(4, "0");
  const month = String(source.getUTCMonth() + 1).padStart(2, "0");
  const day = String(source.getUTCDate()).padStart(2, "0");
  const hour = String(source.getUTCHours()).padStart(2, "0");
  const minute = String(source.getUTCMinutes()).padStart(2, "0");
  const second = String(source.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function buildManagedMigrationFileName({ packageId = "", migrationId = "", extension = ".cjs", timestamp = "" } = {}) {
  const normalizedMigrationId = normalizeMigrationId(migrationId, packageId);
  const normalizedExtension = normalizeMigrationExtension(extension, ".cjs");
  const normalizedTimestamp = String(timestamp || "").trim();
  if (!/^\d{14}$/.test(normalizedTimestamp)) {
    throw createCliError(
      `Invalid install-migration mutation in ${packageId}: timestamp must be a 14-digit UTC string (YYYYMMDDHHmmss).`
    );
  }
  return `${normalizedTimestamp}_${normalizedMigrationId}${normalizedExtension}`;
}

function buildManagedMigrationRelativePath({ toDir = "migrations", packageId = "", migrationId = "", extension = ".cjs", timestamp = "" } = {}) {
  const normalizedDirectory = normalizeMigrationDirectory(toDir, packageId);
  const fileName = buildManagedMigrationFileName({
    packageId,
    migrationId,
    extension,
    timestamp
  });
  return path.posix.join(normalizedDirectory, fileName);
}

function buildManagedMigrationRelativePathLabel({ toDir = "migrations", migrationId = "", extension = ".cjs" } = {}) {
  const directory = normalizeRelativePosixPath(String(toDir || "").trim() || "migrations") || "migrations";
  const id = String(migrationId || "<migration-id>").trim() || "<migration-id>";
  const rawExtension = String(extension || ".cjs").trim() || ".cjs";
  const ext = rawExtension.startsWith(".") ? rawExtension : `.${rawExtension}`;
  return `${directory}/<timestamp>_${id}${ext}`.replace(/\/{2,}/g, "/");
}

async function findExistingManagedMigrationPathById({
  appRoot,
  toDir = "migrations",
  packageId = "",
  migrationId = "",
  extension = ".cjs"
} = {}) {
  const normalizedDirectory = normalizeMigrationDirectory(toDir, packageId);
  const resolvedDirectory = resolveAppRelativePathWithinRoot(
    appRoot,
    normalizedDirectory,
    `${packageId} migration directory for ${migrationId}`
  );
  if (!(await fileExists(resolvedDirectory.absolutePath))) {
    return null;
  }

  const normalizedMigrationId = normalizeMigrationId(migrationId, packageId);
  const normalizedExtension = normalizeMigrationExtension(extension, ".cjs");
  const suffix = `_${normalizedMigrationId}${normalizedExtension}`;
  const entries = await readdir(resolvedDirectory.absolutePath, { withFileTypes: true }).catch(() => []);
  const matches = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const fileName = String(entry.name || "").trim();
    if (!fileName.endsWith(suffix)) {
      continue;
    }
    const timestamp = fileName.slice(0, fileName.length - suffix.length);
    if (!/^\d{14}$/.test(timestamp)) {
      continue;
    }
    matches.push({
      relativePath: path.posix.join(resolvedDirectory.relativePath, fileName),
      absolutePath: path.join(resolvedDirectory.absolutePath, fileName)
    });
  }

  matches.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (matches.length > 1) {
    throw createCliError(
      `${packageId}: found multiple migration files for ${normalizedMigrationId} in ${resolvedDirectory.relativePath}. Keep one file for this migration id.`
    );
  }
  return matches[0] || null;
}

function upsertManagedMigrationRecord(managedMigrations, record) {
  const records = ensureArray(managedMigrations);
  const normalizedId = String(ensureObject(record).id || "").trim();
  if (!normalizedId) {
    return;
  }

  const nextRecord = {
    ...ensureObject(record),
    id: normalizedId
  };
  const existingIndex = records.findIndex(
    (entry) => String(ensureObject(entry).id || "").trim() === normalizedId
  );
  if (existingIndex >= 0) {
    records[existingIndex] = nextRecord;
    return;
  }

  records.push(nextRecord);
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(absolutePath) {
  const source = await readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

async function writeJsonFile(absolutePath, value) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readFileBufferIfExists(absolutePath) {
  if (!(await fileExists(absolutePath))) {
    return {
      exists: false,
      buffer: Buffer.alloc(0)
    };
  }

  return {
    exists: true,
    buffer: await readFile(absolutePath)
  };
}

async function loadAppConfigModuleConfig(appRoot, relativePath) {
  const absolutePath = path.join(appRoot, relativePath);
  if (!(await fileExists(absolutePath))) {
    return {};
  }

  let moduleNamespace = null;
  try {
    moduleNamespace = await import(`${pathToFileURL(absolutePath).href}?t=${Date.now()}_${Math.random()}`);
  } catch (error) {
    throw createCliError(
      `Unable to load ${relativePath}: ${String(error?.message || error || "unknown error")}`
    );
  }

  const defaultExport = ensureObject(moduleNamespace?.default);
  const fromNamedExport = ensureObject(moduleNamespace?.config);
  const fromDefaultConfig = ensureObject(defaultExport?.config);

  if (Object.keys(fromNamedExport).length > 0) {
    return fromNamedExport;
  }
  if (Object.keys(fromDefaultConfig).length > 0) {
    return fromDefaultConfig;
  }
  return defaultExport;
}

async function loadMutationWhenConfigContext(appRoot) {
  const publicConfig = await loadAppConfigModuleConfig(appRoot, PUBLIC_APP_CONFIG_RELATIVE_PATH);
  const serverConfig = await loadAppConfigModuleConfig(appRoot, SERVER_APP_CONFIG_RELATIVE_PATH);
  return {
    public: publicConfig,
    server: serverConfig,
    merged: {
      ...publicConfig,
      ...serverConfig
    }
  };
}

export {
  buildFileWriteGroups,
  normalizeRelativePath,
  hashBuffer,
  normalizeMigrationExtension,
  normalizeMigrationId,
  resolveAppRelativePathWithinRoot,
  normalizeMigrationDirectory,
  formatMigrationTimestamp,
  buildManagedMigrationFileName,
  buildManagedMigrationRelativePath,
  buildManagedMigrationRelativePathLabel,
  findExistingManagedMigrationPathById,
  upsertManagedMigrationRecord,
  fileExists,
  readJsonFile,
  writeJsonFile,
  readFileBufferIfExists,
  loadAppConfigModuleConfig,
  loadMutationWhenConfigContext
};
