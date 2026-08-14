import { readdir } from "node:fs/promises";
import path from "node:path";
import { createCliError } from "../shared/cliError.js";
import { CLI_PACKAGE_ROOT } from "../shared/pathResolution.js";
import {
  fileExists,
  readJsonFile
} from "./ioAndMigrations.js";

const LOCAL_WORKSPACE_PACKAGE_ROOTS = new Map();
let LOCAL_WORKSPACE_PACKAGE_ID_INDEX = null;

async function hasJskitPackageManifest(packageRoot) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    return false;
  }
  const packageJson = await readJsonFile(packageJsonPath).catch(() => ({}));
  return Boolean(
    packageJson?.jskit &&
    typeof packageJson.jskit === "object" &&
    !Array.isArray(packageJson.jskit) &&
    Object.keys(packageJson.jskit).length > 0
  );
}

async function resolvePackageRootFromNodeModules({ appRoot, packageId }) {
  const normalizedAppRoot = path.resolve(String(appRoot || "").trim());
  const normalizedPackageId = String(packageId || "").trim();
  if (!normalizedAppRoot || !normalizedPackageId) {
    return "";
  }

  const candidateRoot = path.resolve(normalizedAppRoot, "node_modules", ...normalizedPackageId.split("/"));
  if (!(await hasJskitPackageManifest(candidateRoot))) {
    return "";
  }

  return candidateRoot;
}

async function loadLocalWorkspacePackageIdIndex() {
  if (LOCAL_WORKSPACE_PACKAGE_ID_INDEX instanceof Map) {
    return LOCAL_WORKSPACE_PACKAGE_ID_INDEX;
  }

  const repoRoot = path.resolve(CLI_PACKAGE_ROOT, "..", "..");
  const parentDirectories = [
    path.join(repoRoot, "packages"),
    path.join(repoRoot, "tooling")
  ];
  const packageIdIndex = new Map();

  for (const parentDirectory of parentDirectories) {
    if (!(await fileExists(parentDirectory))) {
      continue;
    }

    const entries = await readdir(parentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const candidateRoot = path.join(parentDirectory, entry.name);
      const packageJsonPath = path.join(candidateRoot, "package.json");
      if (!(await fileExists(packageJsonPath))) {
        continue;
      }

      let packageJson = {};
      try {
        packageJson = await readJsonFile(packageJsonPath);
      } catch {
        continue;
      }

      const packageId = String(packageJson?.name || "").trim();
      if (
        !packageId.startsWith("@jskit-ai/") ||
        !packageJson?.jskit ||
        typeof packageJson.jskit !== "object" ||
        Array.isArray(packageJson.jskit) ||
        Object.keys(packageJson.jskit).length === 0
      ) {
        continue;
      }
      if (packageIdIndex.has(packageId)) {
        continue;
      }
      packageIdIndex.set(packageId, candidateRoot);
    }
  }

  LOCAL_WORKSPACE_PACKAGE_ID_INDEX = packageIdIndex;
  return packageIdIndex;
}

async function resolvePackageRootFromLocalWorkspace({ packageId }) {
  const normalizedPackageId = String(packageId || "").trim();
  if (!normalizedPackageId.startsWith("@jskit-ai/")) {
    return "";
  }
  if (LOCAL_WORKSPACE_PACKAGE_ROOTS.has(normalizedPackageId)) {
    return LOCAL_WORKSPACE_PACKAGE_ROOTS.get(normalizedPackageId);
  }

  const packageIdIndex = await loadLocalWorkspacePackageIdIndex();
  const packageRoot = String(packageIdIndex.get(normalizedPackageId) || "").trim();
  LOCAL_WORKSPACE_PACKAGE_ROOTS.set(normalizedPackageId, packageRoot);
  return packageRoot;
}

async function resolvePackageTemplateRoot({
  packageEntry,
  appRoot
} = {}) {
  const packageRoot = String(packageEntry?.rootDir || "").trim();
  if (packageRoot) {
    return packageRoot;
  }

  const installedPackageRoot = await resolvePackageRootFromNodeModules({
    appRoot,
    packageId: packageEntry?.packageId
  });
  if (installedPackageRoot) {
    return installedPackageRoot;
  }

  const localWorkspacePackageRoot = await resolvePackageRootFromLocalWorkspace({
    packageId: packageEntry?.packageId
  });
  if (localWorkspacePackageRoot) {
    return localWorkspacePackageRoot;
  }

  throw createCliError(
    `Package source is not installed for ${String(packageEntry?.packageId || "unknown package")}. ` +
      "Install the exact package in the application before applying its JSKIT metadata."
  );
}

async function cleanupPackageRootCaches() {
  LOCAL_WORKSPACE_PACKAGE_ROOTS.clear();
  LOCAL_WORKSPACE_PACKAGE_ID_INDEX = null;
}

export {
  cleanupPackageRootCaches,
  resolvePackageTemplateRoot
};
