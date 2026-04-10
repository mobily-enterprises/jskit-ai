import { spawn } from "node:child_process";
import {
  mkdir,
  readdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { createCliError } from "../shared/cliError.js";
import { CLI_PACKAGE_ROOT } from "../shared/pathResolution.js";
import {
  fileExists,
  readJsonFile
} from "./ioAndMigrations.js";

const LOCAL_WORKSPACE_PACKAGE_ROOTS = new Map();
const MATERIALIZED_PACKAGE_ROOTS = new Map();
let LOCAL_WORKSPACE_PACKAGE_ID_INDEX = null;

function isInternalCatalogPackageEntry(packageEntry = {}) {
  return (
    String(packageEntry?.sourceType || "").trim() === "catalog" &&
    String(packageEntry?.packageId || "").trim().startsWith("@jskit-ai/")
  );
}

function encodePackageCacheSegment(value = "") {
  return encodeURIComponent(String(value || "").trim() || "unknown");
}

function buildMaterializedCacheKey(packageEntry = {}) {
  const packageId = String(packageEntry?.packageId || "").trim();
  const version = String(packageEntry?.version || "").trim() || "latest";
  return `${packageId}@${version}`;
}

function buildMaterializedInstallRoot({ appRoot, packageEntry }) {
  const packageId = String(packageEntry?.packageId || "").trim();
  const version = String(packageEntry?.version || "").trim() || "latest";
  return path.resolve(
    String(appRoot || "").trim(),
    ".jskit",
    "cache",
    "package-sources",
    encodePackageCacheSegment(packageId),
    encodePackageCacheSegment(version)
  );
}

async function ensureMaterializedInstallWorkspace(installRoot) {
  await mkdir(installRoot, { recursive: true });
  const packageJsonPath = path.join(installRoot, "package.json");
  if (await fileExists(packageJsonPath)) {
    return;
  }

  await writeFile(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: "jskit-package-source-cache",
        private: true,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function installCatalogPackageIntoCache({
  installRoot,
  packageEntry
}) {
  const packageId = String(packageEntry?.packageId || "").trim();
  const version = String(packageEntry?.version || "").trim();
  const packageSpec = version ? `${packageId}@${version}` : packageId;
  await ensureMaterializedInstallWorkspace(installRoot);

  await new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      [
        "install",
        "--no-save",
        "--ignore-scripts",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
        packageSpec
      ],
      {
        cwd: installRoot,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    child.on("error", (error) => {
      reject(
        createCliError(
          `Unable to materialize template source for ${packageId}: ${String(error?.message || error || "unknown error")}`
        )
      );
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = stderr.trim();
      reject(
        createCliError(
          `Unable to materialize template source for ${packageId}. npm install failed` +
            `${detail ? `: ${detail}` : "."}`
        )
      );
    });
  });
}

async function materializeCatalogPackageRoot({
  packageEntry,
  appRoot,
  reportTemplateFetchStatus = null,
  installCatalogPackage = installCatalogPackageIntoCache
} = {}) {
  if (!isInternalCatalogPackageEntry(packageEntry)) {
    return "";
  }

  const packageId = String(packageEntry?.packageId || "").trim();
  const cacheKey = buildMaterializedCacheKey(packageEntry);
  if (MATERIALIZED_PACKAGE_ROOTS.has(cacheKey)) {
    return MATERIALIZED_PACKAGE_ROOTS.get(cacheKey);
  }

  const installRoot = buildMaterializedInstallRoot({ appRoot, packageEntry });
  const candidateRoot = path.join(installRoot, "node_modules", ...packageId.split("/"));
  const descriptorPath = path.join(candidateRoot, "package.descriptor.mjs");
  let didInstallPackage = false;

  if (!(await fileExists(descriptorPath))) {
    if (typeof reportTemplateFetchStatus === "function") {
      reportTemplateFetchStatus({
        packageEntry,
        state: "start"
      });
    }
    await installCatalogPackage({
      installRoot,
      packageEntry
    });
    didInstallPackage = true;
  }

  if (!(await fileExists(descriptorPath))) {
    throw createCliError(
      `Unable to resolve template source for ${packageId} after materialization. Missing package.descriptor.mjs in cache.`
    );
  }

  if (didInstallPackage && typeof reportTemplateFetchStatus === "function") {
    reportTemplateFetchStatus({
      packageEntry,
      state: "complete"
    });
  }

  MATERIALIZED_PACKAGE_ROOTS.set(cacheKey, candidateRoot);
  return candidateRoot;
}

async function resolvePackageRootFromNodeModules({ appRoot, packageId }) {
  const normalizedAppRoot = path.resolve(String(appRoot || "").trim());
  const normalizedPackageId = String(packageId || "").trim();
  if (!normalizedAppRoot || !normalizedPackageId) {
    return "";
  }

  const candidateRoot = path.resolve(normalizedAppRoot, "node_modules", ...normalizedPackageId.split("/"));
  const candidateDescriptorPath = path.join(candidateRoot, "package.descriptor.mjs");
  if (!(await fileExists(candidateDescriptorPath))) {
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
      const descriptorPath = path.join(candidateRoot, "package.descriptor.mjs");
      if (!(await fileExists(packageJsonPath)) || !(await fileExists(descriptorPath))) {
        continue;
      }

      let packageJson = {};
      try {
        packageJson = await readJsonFile(packageJsonPath);
      } catch {
        continue;
      }

      const packageId = String(packageJson?.name || "").trim();
      if (!packageId.startsWith("@jskit-ai/")) {
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
  appRoot,
  reportTemplateFetchStatus = null,
  materializeCatalogRoot = materializeCatalogPackageRoot
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

  const materializedCatalogPackageRoot = await materializeCatalogRoot({
    packageEntry,
    appRoot,
    reportTemplateFetchStatus
  });
  if (materializedCatalogPackageRoot) {
    return materializedCatalogPackageRoot;
  }

  throw createCliError(
    `Unable to resolve local template source for ${String(packageEntry?.packageId || "unknown package")}. ` +
      "Install it in node_modules or ensure it exists in the local jskit-ai workspace."
  );
}

async function cleanupMaterializedPackageRoots() {
  LOCAL_WORKSPACE_PACKAGE_ROOTS.clear();
  MATERIALIZED_PACKAGE_ROOTS.clear();
  LOCAL_WORKSPACE_PACKAGE_ID_INDEX = null;
}

export {
  cleanupMaterializedPackageRoots,
  materializeCatalogPackageRoot,
  resolvePackageTemplateRoot
};
