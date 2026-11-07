import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { deepFreeze } from "../../shared/support/deepFreeze.js";
import { normalizeObject } from "../../shared/support/normalize.js";
import { sortStrings } from "../../shared/support/sorting.js";
import { fileExists, readJsonFile } from "./fileSystem.js";

const ROOT_DEPENDENCY_SECTIONS = Object.freeze([
  "dependencies",
  "optionalDependencies",
  "peerDependencies"
]);
const JSKIT_PACKAGE_CONFIG_KEYS = Object.freeze([
  "capabilities",
  "kind",
  "metadata",
  "migrations",
  "runtime",
  "vite"
]);

function collectRootDependencySpecifiers(packageJson = {}) {
  const specifiers = new Map();
  for (const sectionName of ROOT_DEPENDENCY_SECTIONS) {
    for (const [packageId, specifier] of Object.entries(normalizeObject(packageJson?.[sectionName]))) {
      const normalizedPackageId = String(packageId || "").trim();
      if (!normalizedPackageId || specifiers.has(normalizedPackageId)) {
        continue;
      }
      specifiers.set(normalizedPackageId, String(specifier || "").trim());
    }
  }
  return specifiers;
}

function collectPackageDependencyIds(packageJson = {}) {
  const dependencyIds = new Set();
  for (const sectionName of ROOT_DEPENDENCY_SECTIONS) {
    for (const packageId of Object.keys(normalizeObject(packageJson?.[sectionName]))) {
      const normalizedPackageId = String(packageId || "").trim();
      if (normalizedPackageId) {
        dependencyIds.add(normalizedPackageId);
      }
    }
  }
  return sortStrings([...dependencyIds]);
}

function createPackageMetadata(packageJson = {}) {
  const jskit = normalizeObject(packageJson.jskit);
  if (Object.keys(jskit).length === 0) {
    return null;
  }

  const packageId = String(packageJson.name || "").trim();
  const version = String(packageJson.version || "").trim();
  if (!packageId || !version) {
    return null;
  }
  const unknownKeys = Object.keys(jskit)
    .filter((key) => !JSKIT_PACKAGE_CONFIG_KEYS.includes(key))
    .sort();
  if (unknownKeys.length > 0) {
    throw new Error(
      `${packageId} package.json#jskit contains unknown ${unknownKeys.length === 1 ? "field" : "fields"}: ${unknownKeys.join(", ")}.`
    );
  }

  return Object.freeze({
    ...jskit,
    packageId,
    version,
    ...(String(packageJson.description || "").trim()
      ? { description: String(packageJson.description).trim() }
      : {})
  });
}

function resolveFileDependencyRoot(appRoot, specifier = "") {
  const normalizedSpecifier = String(specifier || "").trim();
  if (!normalizedSpecifier.startsWith("file:")) {
    return "";
  }
  const relativePath = normalizedSpecifier.slice("file:".length).trim();
  return relativePath ? path.resolve(appRoot, relativePath) : "";
}

// The directory holding the package's package.json, looked up as Node resolves it from the package that depends on
// it, or "" when none is installed.
async function resolveInstalledPackageRoot({ appRoot, packageId, parentPackageRoot = "" }) {
  const candidates = [];
  const seen = new Set();
  const appendCandidate = (candidateRoot) => {
    const normalized = path.resolve(candidateRoot);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
  };

  if (parentPackageRoot) {
    let currentRoot = path.resolve(parentPackageRoot);
    while (true) {
      // As in Node's resolution, a directory named node_modules has no node_modules of its own.
      if (path.basename(currentRoot) !== "node_modules") {
        appendCandidate(path.join(currentRoot, "node_modules", ...packageId.split("/")));
      }
      const parentRoot = path.dirname(currentRoot);
      if (parentRoot === currentRoot) {
        break;
      }
      currentRoot = parentRoot;
    }
  }
  appendCandidate(path.resolve(appRoot, "node_modules", ...packageId.split("/")));

  for (const candidateRoot of candidates) {
    if (await fileExists(path.join(candidateRoot, "package.json"))) {
      return candidateRoot;
    }
  }
  return "";
}

async function resolvePackageRoots({
  appRoot,
  packageId,
  directSpecifier = "",
  parentPackageRoot = ""
}) {
  const foundPackageRoot = await resolveInstalledPackageRoot({
    appRoot,
    packageId,
    parentPackageRoot
  });
  const installedPackageRoot = foundPackageRoot || path.resolve(appRoot, "node_modules", ...packageId.split("/"));
  const fileDependencyRoot = resolveFileDependencyRoot(appRoot, directSpecifier);
  let sourcePackageRoot =
    fileDependencyRoot &&
    (await fileExists(path.join(fileDependencyRoot, "package.json")))
      ? fileDependencyRoot
      : "";

  if (!sourcePackageRoot && foundPackageRoot) {
    try {
      const resolvedRoot = await realpath(installedPackageRoot);
      const relativeToNodeModules = path.relative(path.resolve(appRoot, "node_modules"), resolvedRoot);
      if (
        relativeToNodeModules === ".." ||
        relativeToNodeModules.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToNodeModules)
      ) {
        sourcePackageRoot = resolvedRoot;
      }
    } catch {
      sourcePackageRoot = "";
    }
  }

  return {
    installedPackageRoot,
    sourcePackageRoot,
    packageRoot: sourcePackageRoot || installedPackageRoot,
    sourceType: sourcePackageRoot ? "local-package" : "npm-package"
  };
}

// A discovery reads the manifest of every installed package, npm's own included, and an app's server boot and its
// database preparation each ask for it. npm rewrites node_modules/.package-lock.json on every install, so a process
// reuses an app's discovery while that file, the app's package.json and its local packages' manifests keep their size
// and modification time. Without that file (another package manager, a node_modules written by hand) every call
// discovers afresh.
const discoveries = new Map();

async function fileStamp(filePath) {
  try {
    const { mtimeMs, size } = await stat(filePath);
    return `${mtimeMs}:${size}`;
  } catch {
    return "";
  }
}

async function stampsOf(filePaths) {
  return (await Promise.all(filePaths.map(fileStamp))).join("\n");
}

async function discoverInstalledPackages({ appRoot } = {}) {
  const normalizedAppRoot = String(appRoot || "").trim();
  if (!normalizedAppRoot) {
    throw new TypeError("discoverInstalledPackages requires appRoot.");
  }

  const appKey = path.resolve(normalizedAppRoot);
  const kept = discoveries.get(appKey);
  if (kept && (await stampsOf(kept.watchedPaths)) === kept.stamps) {
    return kept.packages;
  }
  discoveries.delete(appKey);

  // Stamped before reading, so a file that changes during the walk is read again next time.
  const watchedPaths = [path.join(appKey, "package.json"), path.join(appKey, "node_modules", ".package-lock.json")];
  const watchedStamps = await Promise.all(watchedPaths.map(fileStamp));
  const { packages, localManifests } = await walkInstalledPackages(normalizedAppRoot);
  if (watchedStamps[1]) {
    discoveries.set(appKey, {
      watchedPaths: [...watchedPaths, ...localManifests.map(({ manifestPath }) => manifestPath)],
      stamps: [...watchedStamps, ...localManifests.map(({ stamp }) => stamp)].join("\n"),
      packages
    });
  }
  return packages;
}

async function walkInstalledPackages(normalizedAppRoot) {
  const rootPackageJson = await readJsonFile(path.resolve(normalizedAppRoot, "package.json"), {});
  const directSpecifiers = collectRootDependencySpecifiers(rootPackageJson);
  const directPackageIds = new Set(directSpecifiers.keys());
  const visited = new Set();
  const localManifests = [];
  // Breadth-first walk of the dependency graph; the queue stays ordered by packageId.
  const queue = [];
  const queued = new Set();
  const packages = [];

  const enqueue = ({ packageId, parentPackageRoot = "" }) => {
    if (!packageId || visited.has(packageId) || queued.has(packageId)) {
      return;
    }
    let index = 0;
    for (let high = queue.length; index < high;) {
      const middle = (index + high) >> 1;
      if (queue[middle].packageId.localeCompare(packageId) < 0) {
        index = middle + 1;
      } else {
        high = middle;
      }
    }
    queue.splice(index, 0, { packageId, parentPackageRoot });
    queued.add(packageId);
  };

  for (const packageId of sortStrings([...directPackageIds])) {
    enqueue({ packageId });
  }

  while (queue.length > 0) {
    const { packageId, parentPackageRoot } = queue.shift();
    queued.delete(packageId);
    if (!packageId || visited.has(packageId)) {
      continue;
    }
    visited.add(packageId);

    const directSpecifier = directSpecifiers.get(packageId) || "";
    const roots = await resolvePackageRoots({
      appRoot: normalizedAppRoot,
      packageId,
      directSpecifier,
      parentPackageRoot
    });
    const packageJsonPath = path.join(roots.packageRoot, "package.json");
    if (roots.sourceType === "local-package") {
      localManifests.push({ manifestPath: packageJsonPath, stamp: await fileStamp(packageJsonPath) });
    }
    const packageJson = await readJsonFile(packageJsonPath, null);
    if (!packageJson) {
      continue;
    }
    const packageMetadata = createPackageMetadata(packageJson);
    // An npm alias ("alias": "npm:real@1") installs another package under the alias name,
    // which is only an error for JSKIT packages.
    if (packageMetadata && packageMetadata.packageId !== packageId) {
      throw new Error(
        `Installed package manifest mismatch: expected ${packageId}, received ${packageMetadata.packageId}.`
      );
    }

    const dependencyIds = collectPackageDependencyIds(packageJson);
    for (const dependencyId of dependencyIds) {
      enqueue({ packageId: dependencyId, parentPackageRoot: roots.packageRoot });
    }

    if (!packageMetadata) {
      continue;
    }

    packages.push(
      Object.freeze({
        packageId,
        version: String(packageJson.version || "").trim(),
        packageMetadata: deepFreeze(packageMetadata),
        manifestPath: packageJsonPath,
        packageJson: deepFreeze({ ...normalizeObject(packageJson) }),
        packageRoot: roots.packageRoot,
        installedPackageRoot: roots.installedPackageRoot,
        sourcePackageRoot: roots.sourcePackageRoot || roots.packageRoot,
        sourceType: roots.sourceType,
        direct: directPackageIds.has(packageId),
        directSpecifier,
        dependencyIds: Object.freeze(dependencyIds)
      })
    );
  }

  return {
    packages: Object.freeze(packages.sort((left, right) => left.packageId.localeCompare(right.packageId))),
    localManifests
  };
}

export {
  JSKIT_PACKAGE_CONFIG_KEYS,
  ROOT_DEPENDENCY_SECTIONS,
  collectPackageDependencyIds,
  collectRootDependencySpecifiers,
  createPackageMetadata,
  discoverInstalledPackages
};
