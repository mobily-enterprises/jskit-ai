import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadInstalledPackageDescriptor } from "../../shared/support/packageDescriptor.js";
import { normalizeObject } from "../../shared/support/normalize.js";
import { sortStrings } from "../../shared/support/sorting.js";
import {
  normalizeDescriptorClientProviders,
  normalizeDescriptorClientOptimizeIncludeSpecifiers,
  normalizeDescriptorUiRoutes,
  normalizeClientDescriptorSections
} from "../descriptorSections.js";

const CLIENT_BOOTSTRAP_VIRTUAL_ID = "virtual:jskit-client-bootstrap";
const CLIENT_BOOTSTRAP_RESOLVED_ID = `\0${CLIENT_BOOTSTRAP_VIRTUAL_ID}`;
const CLIENT_RUNTIME_DEDUPE_SPECIFIERS = Object.freeze([
  "@tanstack/vue-query",
  "vue",
  "vue-router",
  "vuetify"
]);

function isLocalScopePackageId(value) {
  return String(value || "").trim().startsWith("@local/");
}

async function readJsonFile(filePath, fallback) {
  try {
    const source = await readFile(filePath, "utf8");
    return JSON.parse(source);
  } catch {
    return fallback;
  }
}

function hasClientExport(packageJson) {
  const exportsMap = normalizeObject(packageJson?.exports);
  return Boolean(exportsMap["./client"]);
}

async function resolveInstalledClientModules({ appRoot, lockPath }) {
  const absoluteLockPath = path.resolve(appRoot, lockPath);
  const lockPayload = await readJsonFile(absoluteLockPath, {});
  const installedPackages = normalizeObject(lockPayload.installedPackages);
  const packageIds = sortStrings(Object.keys(installedPackages));

  const modules = [];
  for (const packageId of packageIds) {
    const installedPackageState = normalizeObject(installedPackages[packageId]);
    const packageJsonPath = path.resolve(appRoot, "node_modules", ...packageId.split("/"), "package.json");
    const packageJson = await readJsonFile(packageJsonPath, {});
    if (!hasClientExport(packageJson)) {
      continue;
    }

    const descriptorRecord = await loadInstalledPackageDescriptor({
      appRoot,
      packageId,
      installedPackageState,
      required: false
    });
    const descriptorSections = normalizeClientDescriptorSections(descriptorRecord.descriptor);

    modules.push(
      Object.freeze({
        packageId,
        sourceType: String(installedPackageState?.source?.type || "").trim().toLowerCase(),
        descriptorUiRoutes: descriptorSections.descriptorUiRoutes,
        descriptorClientProviders: descriptorSections.descriptorClientProviders,
        descriptorClientOptimizeIncludeSpecifiers: descriptorSections.descriptorClientOptimizeIncludeSpecifiers
      })
    );
  }

  return Object.freeze(modules);
}

async function resolveInstalledClientPackageIds(options) {
  const modules = await resolveInstalledClientModules(options);
  return Object.freeze(modules.map((entry) => entry.packageId));
}

async function resolveLocalScopePackageIds({ appRoot, lockPath }) {
  const absoluteLockPath = path.resolve(appRoot, lockPath);
  const lockPayload = await readJsonFile(absoluteLockPath, {});
  const installedPackages = normalizeObject(lockPayload.installedPackages);
  const localScopeFromLock = Object.keys(installedPackages).filter((packageId) => isLocalScopePackageId(packageId));

  const appPackageJson = await readJsonFile(path.resolve(appRoot, "package.json"), {});
  const localScopeFromPackageJson = Object.keys({
    ...normalizeObject(appPackageJson.dependencies),
    ...normalizeObject(appPackageJson.devDependencies),
    ...normalizeObject(appPackageJson.optionalDependencies),
    ...normalizeObject(appPackageJson.peerDependencies)
  }).filter((packageId) => isLocalScopePackageId(packageId));

  return Object.freeze(sortStrings([...localScopeFromLock, ...localScopeFromPackageJson]));
}

function normalizeClientModuleDescriptors(value) {
  const items = Array.isArray(value) ? value : [];
  const descriptors = [];

  for (const item of items) {
    const record = normalizeObject(item);
    const packageId = String(record.packageId || "").trim();
    if (!packageId) {
      continue;
    }
    const sourceType = String(record.sourceType || "").trim().toLowerCase();
    descriptors.push({
      packageId,
      sourceType,
      descriptorUiRoutes: normalizeDescriptorUiRoutes(record.descriptorUiRoutes),
      descriptorClientProviders: normalizeDescriptorClientProviders(record.descriptorClientProviders),
      descriptorClientOptimizeIncludeSpecifiers: normalizeDescriptorClientOptimizeIncludeSpecifiers(
        record.descriptorClientOptimizeIncludeSpecifiers
      )
    });
  }

  return Object.freeze(
    descriptors.sort((left, right) => left.packageId.localeCompare(right.packageId))
  );
}

function createVirtualModuleSource(clientModules = []) {
  const moduleDescriptors = normalizeClientModuleDescriptors(clientModules);
  const importLines = moduleDescriptors.map(
    (entry, index) => `import * as clientModule${index} from ${JSON.stringify(`${entry.packageId}/client`)};`
  );
  const moduleEntries = moduleDescriptors.map(
    (entry, index) =>
      `  { packageId: ${JSON.stringify(entry.packageId)}, module: clientModule${index}, descriptorUiRoutes: ${JSON.stringify(entry.descriptorUiRoutes)}, descriptorClientProviders: ${JSON.stringify(entry.descriptorClientProviders)} }`
  );

  const entriesSource = moduleEntries.length > 0 ? moduleEntries.join(",\n") : "";

  return `${importLines.join("\n")}${importLines.length > 0 ? "\n\n" : ""}import { bootClientModules } from "@jskit-ai/kernel/client/moduleBootstrap";

const installedClientModules = Object.freeze([
${entriesSource}
]);

async function bootInstalledClientModules(context = {}) {
  return bootClientModules({
    ...context,
    clientModules: installedClientModules
  });
}

export { installedClientModules, bootInstalledClientModules };
`;
}

// Vite-only: this Set-based source-type filter exists solely to drive optimizeDeps include/exclude decisions.
function resolveClientOptimizeExcludeSpecifiers(clientModules = []) {
  const moduleDescriptors = normalizeClientModuleDescriptors(clientModules);
  const localSourceTypes = new Set(["local-package", "app-local-package"]);
  return sortStrings(
    moduleDescriptors
      .filter((entry) => localSourceTypes.has(entry.sourceType))
      .flatMap((entry) => [entry.packageId, `${entry.packageId}/shared`, `${entry.packageId}/client`])
  );
}

function resolveClientOptimizeIncludeSpecifiers(clientModules = []) {
  const moduleDescriptors = normalizeClientModuleDescriptors(clientModules);
  const localSourceTypes = new Set(["local-package", "app-local-package"]);
  return sortStrings(
    [
      ...moduleDescriptors
      .filter((entry) => !localSourceTypes.has(entry.sourceType))
      .map((entry) => `${entry.packageId}/client`),
      ...moduleDescriptors.flatMap((entry) => entry.descriptorClientOptimizeIncludeSpecifiers || [])
    ]
  );
}

function resolveLocalScopeOptimizeExcludeSpecifiers(localScopePackageIds = []) {
  return sortStrings(
    localScopePackageIds.flatMap((packageId) => [packageId, `${packageId}/shared`, `${packageId}/client`])
  );
}

function resolveClientRuntimeDedupeSpecifiers(userResolveConfig = {}) {
  const resolveConfig = normalizeObject(userResolveConfig);
  const userDedupe = sortStrings(resolveConfig.dedupe);
  return sortStrings([...userDedupe, ...CLIENT_RUNTIME_DEDUPE_SPECIFIERS]);
}

function createJskitClientBootstrapPlugin({ lockPath = ".jskit/lock.json" } = {}) {
  return {
    name: "jskit-client-bootstrap",
    async config(userConfig = {}) {
      const appRoot = process.cwd();
      const clientModules = await resolveInstalledClientModules({
        appRoot,
        lockPath
      });
      const localScopePackageIds = await resolveLocalScopePackageIds({
        appRoot,
        lockPath
      });
      const clientExcludeSpecifiers = resolveClientOptimizeExcludeSpecifiers(clientModules);
      const localScopeExcludeSpecifiers = resolveLocalScopeOptimizeExcludeSpecifiers(localScopePackageIds);
      const clientIncludeSpecifiers = resolveClientOptimizeIncludeSpecifiers(clientModules);
      const userOptimizeDeps = normalizeObject(userConfig.optimizeDeps);
      const userExclude = sortStrings(userOptimizeDeps.exclude);
      const userInclude = sortStrings(userOptimizeDeps.include);
      const exclude = sortStrings([...userExclude, ...clientExcludeSpecifiers, ...localScopeExcludeSpecifiers]);
      const include = sortStrings([...userInclude, ...clientIncludeSpecifiers]);
      const userResolve = normalizeObject(userConfig.resolve);
      const dedupe = resolveClientRuntimeDedupeSpecifiers(userResolve);

      return {
        optimizeDeps: {
          ...userOptimizeDeps,
          include,
          exclude
        },
        resolve: {
          ...userResolve,
          dedupe
        }
      };
    },
    resolveId(source) {
      if (source === CLIENT_BOOTSTRAP_VIRTUAL_ID) {
        return CLIENT_BOOTSTRAP_RESOLVED_ID;
      }
      return null;
    },
    async load(id) {
      if (id !== CLIENT_BOOTSTRAP_RESOLVED_ID) {
        return null;
      }

      const clientModules = await resolveInstalledClientModules({
        appRoot: process.cwd(),
        lockPath
      });

      return createVirtualModuleSource(clientModules);
    }
  };
}

export {
  CLIENT_BOOTSTRAP_VIRTUAL_ID,
  CLIENT_BOOTSTRAP_RESOLVED_ID,
  createVirtualModuleSource,
  resolveClientOptimizeIncludeSpecifiers,
  resolveClientOptimizeExcludeSpecifiers,
  resolveLocalScopeOptimizeExcludeSpecifiers,
  resolveInstalledClientPackageIds,
  resolveLocalScopePackageIds,
  resolveInstalledClientModules,
  createJskitClientBootstrapPlugin
};
