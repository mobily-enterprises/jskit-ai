import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { normalizeObject } from "../../shared/support/normalize.js";
import { sortStrings } from "../../shared/support/sorting.js";
import { fileExists } from "./fileSystem.js";

const ROOT_DEPENDENCY_SECTIONS = Object.freeze([
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies"
]);
const JSKIT_PACKAGE_CONFIG_KEYS = Object.freeze([
  "capabilities",
  "ci",
  "kind",
  "lifecycle",
  "metadata",
  "mutations",
  "optionPolicies",
  "options",
  "runtime",
  "vite"
]);

async function readJsonFile(filePath, fallback = {}) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

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
  for (const sectionName of ["dependencies", "optionalDependencies", "peerDependencies"]) {
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
      appendCandidate(path.join(currentRoot, "node_modules", ...packageId.split("/")));
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
  return path.resolve(appRoot, "node_modules", ...packageId.split("/"));
}

async function resolvePackageRoots({
  appRoot,
  packageId,
  directSpecifier = "",
  parentPackageRoot = ""
}) {
  const installedPackageRoot = await resolveInstalledPackageRoot({
    appRoot,
    packageId,
    parentPackageRoot
  });
  const fileDependencyRoot = resolveFileDependencyRoot(appRoot, directSpecifier);
  let sourcePackageRoot =
    fileDependencyRoot &&
    (await fileExists(path.join(fileDependencyRoot, "package.json")))
      ? fileDependencyRoot
      : "";

  if (!sourcePackageRoot && (await fileExists(installedPackageRoot))) {
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

async function discoverInstalledPackages({ appRoot } = {}) {
  const normalizedAppRoot = String(appRoot || "").trim();
  if (!normalizedAppRoot) {
    throw new TypeError("discoverInstalledPackages requires appRoot.");
  }

  const rootPackageJson = await readJsonFile(path.resolve(normalizedAppRoot, "package.json"), {});
  const directSpecifiers = collectRootDependencySpecifiers(rootPackageJson);
  const directPackageIds = new Set(directSpecifiers.keys());
  const runtimeRootPackageIds = new Set(
    ["dependencies", "optionalDependencies", "peerDependencies"]
      .flatMap((sectionName) => Object.keys(normalizeObject(rootPackageJson?.[sectionName])))
  );
  const visited = new Set();
  const queue = [];
  const queued = new Map();
  const packages = [];

  const sortQueue = () => {
    queue.sort((left, right) => {
      if (left.traverseDependencies !== right.traverseDependencies) {
        return left.traverseDependencies ? -1 : 1;
      }
      return left.packageId.localeCompare(right.packageId);
    });
  };
  const enqueue = ({ packageId, parentPackageRoot = "", traverseDependencies = false }) => {
    const normalizedPackageId = String(packageId || "").trim();
    if (!normalizedPackageId || visited.has(normalizedPackageId)) {
      return;
    }
    const existing = queued.get(normalizedPackageId);
    if (existing) {
      if (traverseDependencies && !existing.traverseDependencies) {
        existing.traverseDependencies = true;
        existing.parentPackageRoot = parentPackageRoot || existing.parentPackageRoot;
        sortQueue();
      }
      return;
    }
    const entry = {
      packageId: normalizedPackageId,
      parentPackageRoot,
      traverseDependencies: Boolean(traverseDependencies)
    };
    queue.push(entry);
    queued.set(normalizedPackageId, entry);
    sortQueue();
  };

  for (const packageId of sortStrings([...directPackageIds])) {
    enqueue({
      packageId,
      traverseDependencies: runtimeRootPackageIds.has(packageId)
    });
  }

  while (queue.length > 0) {
    const { packageId, parentPackageRoot, traverseDependencies } = queue.shift();
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
    if (!(await fileExists(packageJsonPath))) {
      continue;
    }

    const packageJson = await readJsonFile(packageJsonPath, {});
    const manifestPackageId = String(packageJson.name || "").trim();
    if (manifestPackageId && manifestPackageId !== packageId) {
      throw new Error(
        `Installed package manifest mismatch: expected ${packageId}, received ${manifestPackageId}.`
      );
    }

    const dependencyIds = collectPackageDependencyIds(packageJson);
    if (traverseDependencies) {
      for (const dependencyId of dependencyIds) {
        const normalizedDependencyId = String(dependencyId || "").trim();
        enqueue({
          packageId: normalizedDependencyId,
          parentPackageRoot: roots.packageRoot,
          traverseDependencies: true
        });
      }
    }

    const packageMetadata = createPackageMetadata(packageJson);
    if (!packageMetadata) {
      continue;
    }

    packages.push(
      Object.freeze({
        packageId,
        version: String(packageJson.version || "").trim(),
        packageMetadata,
        manifestPath: packageJsonPath,
        packageJson: Object.freeze({ ...normalizeObject(packageJson) }),
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

  return Object.freeze(
    packages.sort((left, right) => left.packageId.localeCompare(right.packageId))
  );
}

export {
  JSKIT_PACKAGE_CONFIG_KEYS,
  ROOT_DEPENDENCY_SECTIONS,
  collectPackageDependencyIds,
  collectRootDependencySpecifiers,
  createPackageMetadata,
  discoverInstalledPackages
};
