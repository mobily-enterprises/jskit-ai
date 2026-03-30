import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  validatePackageDescriptorShape,
  validateAppLocalPackageDescriptorShape,
  createPackageEntry,
  isGeneratorPackageEntry
} from "./descriptorValidation.js";

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

function validateBundleDescriptorShape(descriptor, descriptorPath) {
  const normalized = ensureObject(descriptor);
  const bundleId = String(normalized.bundleId || "").trim();
  const version = String(normalized.version || "").trim();
  const packages = ensureArray(normalized.packages).map((value) => String(value));

  if (!bundleId) {
    throw createCliError(`Invalid bundle descriptor at ${descriptorPath}: missing bundleId.`);
  }
  if (!version) {
    throw createCliError(`Invalid bundle descriptor at ${descriptorPath}: missing version.`);
  }
  if (packages.length < 2) {
    throw createCliError(`Invalid bundle descriptor at ${descriptorPath}: bundles must contain at least two packages.`);
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
    const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
    if (!(await fileExists(packageJsonPath)) || !(await fileExists(descriptorPath))) {
      continue;
    }

    const packageJson = await readJsonFile(packageJsonPath);
    const packageId = String(packageJson?.name || "").trim();
    if (!packageId) {
      throw createCliError(`Invalid app-local package at ${normalizeRelativePath(appRoot, packageRoot)}: package.json missing name.`);
    }

    const descriptorModule = await import(pathToFileURL(descriptorPath).href + `?t=${Date.now()}_${Math.random()}`);
    const descriptor = validateAppLocalPackageDescriptorShape(descriptorModule?.default, descriptorPath, {
      expectedPackageId: packageId,
      fallbackVersion: String(packageJson?.version || "").trim()
    });

    const relativeDir = normalizeRelativePath(appRoot, packageRoot);
    const descriptorRelativePath = normalizeRelativePath(appRoot, descriptorPath);
    registry.set(
      packageId,
      createPackageEntry({
        packageId: descriptor.packageId,
        version: descriptor.version,
        descriptor,
        rootDir: packageRoot,
        relativeDir,
        descriptorRelativePath,
        packageJson,
        sourceType: "app-local-package",
        source: {
          packagePath: normalizeRelativePosixPath(relativeDir),
          descriptorPath: descriptorRelativePath
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
    const descriptorPath = `${normalizeRelativePath(CLI_PACKAGE_ROOT, CATALOG_PACKAGES_PATH)}#${packageId || "unknown"}`;
    const descriptor = validatePackageDescriptorShape(record.descriptor, descriptorPath);
    if (!packageId) {
      throw createCliError(`Invalid catalog package entry at ${descriptorPath}: missing packageId.`);
    }
    if (descriptor.packageId !== packageId) {
      throw createCliError(
        `Invalid catalog package entry at ${descriptorPath}: descriptor packageId ${descriptor.packageId} does not match catalog packageId ${packageId}.`
      );
    }

    const version = String(record.version || descriptor.version || "").trim();
    if (!version) {
      throw createCliError(`Invalid catalog package entry at ${descriptorPath}: missing version.`);
    }

    registry.set(
      packageId,
      createPackageEntry({
        packageId,
        version,
        descriptor: {
          ...descriptor,
          version
        },
        rootDir: "",
        relativeDir: "",
        descriptorRelativePath: descriptorPath,
        packageJson: {
          name: packageId,
          version
        },
        sourceType: "catalog",
        source: {
          descriptorPath
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
  const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
  if (!(await fileExists(descriptorPath))) {
    return null;
  }

  const descriptorModule = await import(pathToFileURL(descriptorPath).href + `?t=${Date.now()}_${Math.random()}`);
  const descriptor = validateAppLocalPackageDescriptorShape(descriptorModule?.default, descriptorPath, {
    expectedPackageId: resolvedPackageId,
    fallbackVersion: String(packageJson?.version || "").trim()
  });
  const relativeDir = normalizeRelativePath(appRoot, packageRoot);
  const descriptorRelativePath = normalizeRelativePath(appRoot, descriptorPath);

  return createPackageEntry({
    packageId: descriptor.packageId,
    version: descriptor.version,
    descriptor,
    rootDir: packageRoot,
    relativeDir,
    descriptorRelativePath,
    packageJson,
    sourceType: "npm-installed-package",
    source: {
      packagePath: normalizeRelativePosixPath(relativeDir),
      descriptorPath: descriptorRelativePath
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
  seedPackageIds = []
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
    if (!packageEntry) {
      const resolvedEntry = await resolveInstalledNodeModulePackageEntry({
        appRoot,
        packageId
      });
      if (!resolvedEntry) {
        continue;
      }

      packageRegistry.set(resolvedEntry.packageId, resolvedEntry);
      packageEntry = resolvedEntry;
      if (resolvedEntry.packageId !== packageId && !visited.has(resolvedEntry.packageId)) {
        queue.push(resolvedEntry.packageId);
      }
    }

    const dependsOn = ensureArray(packageEntry?.descriptor?.dependsOn).map((value) => String(value || "").trim()).filter(Boolean);
    for (const dependencyId of dependsOn) {
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

    const descriptorPath = path.join(BUNDLES_ROOT, entry.name, "bundle.descriptor.mjs");
    if (!(await fileExists(descriptorPath))) {
      continue;
    }

    const descriptorModule = await import(pathToFileURL(descriptorPath).href);
    const descriptor = validateBundleDescriptorShape(descriptorModule?.default, descriptorPath);
    bundles.set(descriptor.bundleId, descriptor);
  }

  return bundles;
}

export {
  isGeneratorPackageEntry,
  mergePackageRegistries,
  loadAppLocalPackageRegistry,
  loadPackageRegistry,
  resolveInstalledNodeModulePackageEntry,
  hydratePackageRegistryFromInstalledNodeModules,
  loadBundleRegistry
};
