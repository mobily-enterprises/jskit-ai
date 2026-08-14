import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  collectPackageDependencyIds,
  createPackageMetadata,
  discoverInstalledPackages
} from "@jskit-ai/kernel/server/support";
import { createCliError } from "../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../shared/collectionUtils.js";
import {
  BUNDLES_ROOT,
  CATALOG_PACKAGES_PATH,
  CLI_PACKAGE_ROOT
} from "../shared/pathResolution.js";
import {
  toScopedPackageId
} from "../shared/packageIdHelpers.js";
import {
  fileExists,
  readJsonFile,
  normalizeRelativePath
} from "./ioAndMigrations.js";
import {
  validatePackageMetadataShape,
  validateAppLocalPackageMetadataShape,
  createPackageEntry,
  isGeneratorPackageEntry
} from "./packageMetadataValidation.js";

function normalizeRelativePosixPath(pathValue) {
  return String(pathValue || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function mergePackageRegistries(...registries) {
  const merged = new Map();
  for (const registry of registries) {
    if (!(registry instanceof Map)) {
      continue;
    }
    for (const [packageId, packageEntry] of registry.entries()) {
      merged.set(packageId, packageEntry);
    }
  }
  return merged;
}

function validateBundleMetadataShape(packageMetadata, metadataPath) {
  const normalized = ensureObject(packageMetadata);
  const bundleId = String(normalized.bundleId || "").trim();
  const version = String(normalized.version || "").trim();
  const packages = ensureArray(normalized.packages).map((value) => String(value));

  if (!bundleId) {
    throw createCliError(`Invalid bundle metadata at ${metadataPath}: missing bundleId.`);
  }
  if (!version) {
    throw createCliError(`Invalid bundle metadata at ${metadataPath}: missing version.`);
  }
  if (packages.length < 2) {
    throw createCliError(`Invalid bundle metadata at ${metadataPath}: bundles must contain at least two packages.`);
  }

  return normalized;
}

async function loadAppLocalPackageRegistry(appRoot) {
  const localPackagesRoot = path.join(appRoot, "packages");
  if (!(await fileExists(localPackagesRoot))) {
    return new Map();
  }

  const registry = new Map();
  const entries = await readdir(localPackagesRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const packageRoot = path.join(localPackagesRoot, entry.name);
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!(await fileExists(packageJsonPath))) {
      continue;
    }

    const packageJson = await readJsonFile(packageJsonPath);
    const packageId = String(packageJson?.name || "").trim();
    if (!packageId) {
      throw createCliError(`Invalid app-local package at ${normalizeRelativePath(appRoot, packageRoot)}: package.json missing name.`);
    }

    const rawPackageMetadata = createPackageMetadata(packageJson);
    if (!rawPackageMetadata) {
      continue;
    }
    const packageMetadata = validateAppLocalPackageMetadataShape(rawPackageMetadata, packageJsonPath, {
      expectedPackageId: packageId
    });

    const relativeDir = normalizeRelativePath(appRoot, packageRoot);
    const manifestRelativePath = normalizeRelativePath(appRoot, packageJsonPath);
    registry.set(
      packageId,
      createPackageEntry({
        packageId: packageMetadata.packageId,
        version: packageMetadata.version,
        packageMetadata,
        rootDir: packageRoot,
        relativeDir,
        manifestRelativePath,
        packageJson,
        sourceType: "app-local-package",
        source: {
          packagePath: normalizeRelativePosixPath(relativeDir),
          manifestPath: manifestRelativePath
        }
      })
    );
  }

  return registry;
}

async function loadCatalogPackageRegistry() {
  if (!(await fileExists(CATALOG_PACKAGES_PATH))) {
    return new Map();
  }

  const catalog = await readJsonFile(CATALOG_PACKAGES_PATH);
  const packageRecords = ensureArray(catalog?.packages);
  const registry = new Map();

  for (const packageRecord of packageRecords) {
    const record = ensureObject(packageRecord);
    const packageId = String(record.packageId || "").trim();
    const manifestPath = `${normalizeRelativePath(CLI_PACKAGE_ROOT, CATALOG_PACKAGES_PATH)}#${packageId || "unknown"}`;
    if (!packageId) {
      throw createCliError(`Invalid catalog package entry at ${manifestPath}: missing packageId.`);
    }
    const version = String(record.version || "").trim();
    if (!version) {
      throw createCliError(`Invalid catalog package entry at ${manifestPath}: missing version.`);
    }
    const packageMetadata = validatePackageMetadataShape({
      ...ensureObject(record.jskit),
      packageId,
      version,
      ...(String(record.description || "").trim()
        ? { description: String(record.description).trim() }
        : {})
    }, manifestPath);

    registry.set(
      packageId,
      createPackageEntry({
        packageId,
        version,
        packageMetadata: {
          ...packageMetadata,
          version
        },
        rootDir: "",
        relativeDir: "",
        manifestRelativePath: manifestPath,
        packageJson: {
          ...ensureObject(record.packageJson),
          name: packageId,
          version
        },
        sourceType: "catalog",
        source: {
          manifestPath
        }
      })
    );
  }

  return registry;
}

async function loadPackageRegistry() {
  const catalogRegistry = await loadCatalogPackageRegistry();
  if (catalogRegistry.size === 0) {
    throw createCliError(
      "Unable to load package registry from @jskit-ai/jskit-catalog. Install it alongside @jskit-ai/jskit-cli or set JSKIT_CATALOG_PACKAGES_PATH."
    );
  }

  return catalogRegistry;
}

async function loadInstalledNodeModulePackageEntry({ appRoot, packageId }) {
  const normalizedPackageId = String(packageId || "").trim();
  if (!normalizedPackageId) {
    return null;
  }

  const packageRoot = path.resolve(appRoot, "node_modules", ...normalizedPackageId.split("/"));
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    return null;
  }

  const packageJson = await readJsonFile(packageJsonPath);
  const resolvedPackageId = String(packageJson?.name || "").trim() || normalizedPackageId;
  const packageMetadata = createPackageMetadata(packageJson);
  if (!packageMetadata) {
    return null;
  }

  const validatedMetadata = validateAppLocalPackageMetadataShape(packageMetadata, packageJsonPath, {
    expectedPackageId: resolvedPackageId
  });
  const relativeDir = normalizeRelativePath(appRoot, packageRoot);
  const manifestRelativePath = normalizeRelativePath(appRoot, packageJsonPath);

  return createPackageEntry({
    packageId: validatedMetadata.packageId,
    version: validatedMetadata.version,
    packageMetadata: validatedMetadata,
    rootDir: packageRoot,
    relativeDir,
    manifestRelativePath,
    packageJson,
    sourceType: "npm-installed-package",
    source: {
      packagePath: normalizeRelativePosixPath(relativeDir),
      manifestPath: manifestRelativePath
    }
  });
}

async function resolveInstalledNodeModulePackageEntry({ appRoot, packageId }) {
  const raw = String(packageId || "").trim();
  if (!raw) {
    return null;
  }

  const candidates = [];
  const seen = new Set();
  const appendCandidate = (value) => {
    const candidate = String(value || "").trim();
    if (!candidate || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    candidates.push(candidate);
  };

  appendCandidate(raw);
  appendCandidate(toScopedPackageId(raw));

  for (const candidateId of candidates) {
    const entry = await loadInstalledNodeModulePackageEntry({
      appRoot,
      packageId: candidateId
    });
    if (entry) {
      return entry;
    }
  }

  return null;
}

async function hydratePackageRegistryFromInstalledNodeModules({
  appRoot,
  packageRegistry,
  seedPackageIds = [],
  preferInstalledPackages = false
}) {
  const queue = ensureArray(seedPackageIds)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const visited = new Set();

  while (queue.length > 0) {
    const packageId = queue.shift();
    if (!packageId || visited.has(packageId)) {
      continue;
    }
    visited.add(packageId);

    let packageEntry = packageRegistry.get(packageId);
    const shouldResolveInstalledPackage =
      !packageEntry ||
      (preferInstalledPackages && packageEntry.sourceType !== "app-local-package");
    if (shouldResolveInstalledPackage) {
      const resolvedEntry = await resolveInstalledNodeModulePackageEntry({
        appRoot,
        packageId
      });
      if (!resolvedEntry && !packageEntry) {
        continue;
      }
      if (resolvedEntry) {
        packageRegistry.set(resolvedEntry.packageId, resolvedEntry);
        packageEntry = resolvedEntry;
        if (resolvedEntry.packageId !== packageId && !visited.has(resolvedEntry.packageId)) {
          queue.push(resolvedEntry.packageId);
        }
      }
    }

    for (const dependencyId of collectPackageDependencyIds(packageEntry?.packageJson)) {
      if (!visited.has(dependencyId)) {
        queue.push(dependencyId);
      }
    }
  }
}

async function loadBundleRegistry() {
  if (!(await fileExists(BUNDLES_ROOT))) {
    return new Map();
  }

  const bundles = new Map();
  const entries = await readdir(BUNDLES_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const bundlePath = path.join(BUNDLES_ROOT, entry.name, "bundle.json");
    if (!(await fileExists(bundlePath))) {
      continue;
    }

    const packageMetadata = validateBundleMetadataShape(await readJsonFile(bundlePath), bundlePath);
    bundles.set(packageMetadata.bundleId, packageMetadata);
  }

  return bundles;
}

async function loadInstalledAppPackageRegistry(appRoot) {
  const discoveredPackages = await discoverInstalledPackages({ appRoot });
  const registry = new Map();
  for (const discoveredPackage of discoveredPackages) {
    registry.set(
      discoveredPackage.packageId,
      createPackageEntry({
        packageId: discoveredPackage.packageId,
        version: discoveredPackage.version,
        packageMetadata: discoveredPackage.packageMetadata,
        rootDir: discoveredPackage.packageRoot,
        relativeDir: normalizeRelativePath(appRoot, discoveredPackage.packageRoot),
        manifestRelativePath: normalizeRelativePath(appRoot, discoveredPackage.manifestPath),
        packageJson: discoveredPackage.packageJson,
        sourceType: discoveredPackage.sourceType === "local-package"
          ? "app-local-package"
          : "npm-installed-package",
        source: {
          type: discoveredPackage.sourceType === "local-package"
            ? "app-local-package"
            : "npm-installed-package",
          packagePath: normalizeRelativePosixPath(
            normalizeRelativePath(appRoot, discoveredPackage.sourcePackageRoot)
          ),
          manifestPath: normalizeRelativePosixPath(
            normalizeRelativePath(appRoot, discoveredPackage.manifestPath)
          )
        }
      })
    );
  }
  return registry;
}

function installedPackageRecordFromRegistry(packageRegistry = new Map()) {
  return Object.fromEntries(
    [...packageRegistry.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([packageId, packageEntry]) => [
        packageId,
        {
          packageId,
          version: String(packageEntry?.version || "").trim(),
          source: ensureObject(packageEntry?.source)
        }
      ])
  );
}

export {
  isGeneratorPackageEntry,
  mergePackageRegistries,
  loadAppLocalPackageRegistry,
  loadPackageRegistry,
  resolveInstalledNodeModulePackageEntry,
  hydratePackageRegistryFromInstalledNodeModules,
  loadBundleRegistry,
  loadInstalledAppPackageRegistry,
  installedPackageRecordFromRegistry
};
