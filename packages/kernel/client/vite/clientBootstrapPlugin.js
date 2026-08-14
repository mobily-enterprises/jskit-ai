import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  collectRootDependencySpecifiers,
  discoverInstalledPackages
} from "../../internal/node/installedPackages.js";
import { normalizeObject } from "../../shared/support/normalize.js";
import { sortStrings } from "../../shared/support/sorting.js";
import {
  normalizePackageMetadataClientProviders,
  normalizePackageMetadataClientOptimizeSpecifiers,
  normalizePackageMetadataUiRoutes,
  normalizeClientPackageMetadataSections
} from "../packageMetadataSections.js";

const CLIENT_BOOTSTRAP_VIRTUAL_ID = "virtual:jskit-client-bootstrap";
const CLIENT_BOOTSTRAP_RESOLVED_ID = `\0${CLIENT_BOOTSTRAP_VIRTUAL_ID}`;
const CLIENT_RUNTIME_DEDUPE_SPECIFIERS = Object.freeze([
  "@tanstack/vue-query",
  "pinia",
  "vue",
  "vue-router",
  "vuetify"
]);
const LOCAL_PACKAGE_SOURCE_TYPES = new Set(["local-package", "app-local-package"]);

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

function isPathInsideRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath))
  );
}

/**
 * Generated apps intentionally preserve package symlinks, so a bare import from an editable local
 * package would otherwise keep its node_modules path. optimizeDeps.exclude only prevents prebundling;
 * Vite can still append its dependency-wide ?v hash and serve that source as one-year immutable.
 * That hash does not change when local source changes, which lets a browser reuse stale client code
 * even after Vite restarts.
 *
 * Build this table from every local package declared by the app, not only packages with a ./client export.
 * Resolving only the bootstrap entry is insufficient: a local client can use bare imports from another
 * local package's root, shared entry, or exported subpath and accidentally re-enter node_modules caching.
 */
async function resolveLocalPackageSources({ appRoot }) {
  const appPackageJson = await readJsonFile(path.resolve(appRoot, "package.json"), {});
  const dependencySpecifiers = collectRootDependencySpecifiers(appPackageJson);
  const localPackages = [];

  for (const packageId of sortStrings([...dependencySpecifiers.keys()])) {
    const specifier = dependencySpecifiers.get(packageId);
    if (!specifier.startsWith("file:")) {
      continue;
    }
    const sourcePackageRoot = path.resolve(appRoot, specifier.slice("file:".length));
    const sourcePackageJson = await readJsonFile(
      path.join(sourcePackageRoot, "package.json"),
      null
    );
    if (!sourcePackageJson) {
      continue;
    }
    localPackages.push(
      Object.freeze({
        packageId,
        installedPackageRoot: path.resolve(appRoot, "node_modules", ...packageId.split("/")),
        sourcePackageRoot
      })
    );
  }

  return Object.freeze(localPackages);
}

function splitSpecifierSuffix(source) {
  const normalizedSource = String(source || "");
  const queryIndex = normalizedSource.indexOf("?");
  const hashIndex = normalizedSource.indexOf("#");
  const suffixIndexes = [queryIndex, hashIndex].filter((index) => index >= 0);
  const suffixIndex = suffixIndexes.length > 0 ? Math.min(...suffixIndexes) : -1;
  if (suffixIndex < 0) {
    return [normalizedSource, ""];
  }
  return [normalizedSource.slice(0, suffixIndex), normalizedSource.slice(suffixIndex)];
}

function resolveLocalPackageForSpecifier(source, localPackages = []) {
  const [specifier] = splitSpecifierSuffix(source);
  return (
    (Array.isArray(localPackages) ? localPackages : []).find(
      (entry) => specifier === entry.packageId || specifier.startsWith(`${entry.packageId}/`)
    ) || null
  );
}

function resolveCanonicalLocalPackageId(resolvedId, localPackage) {
  const [resolvedPath, suffix] = splitSpecifierSuffix(resolvedId);
  if (!resolvedPath || resolvedPath.startsWith("\0")) {
    return "";
  }

  if (isPathInsideRoot(localPackage.sourcePackageRoot, resolvedPath)) {
    return `${resolvedPath}${suffix}`;
  }
  if (!isPathInsideRoot(localPackage.installedPackageRoot, resolvedPath)) {
    return "";
  }

  const packageRelativePath = path.relative(localPackage.installedPackageRoot, resolvedPath);
  const canonicalPath = path.resolve(localPackage.sourcePackageRoot, packageRelativePath);
  return isPathInsideRoot(localPackage.sourcePackageRoot, canonicalPath)
    ? `${canonicalPath}${suffix}`
    : "";
}

async function resolveInstalledClientModules({ appRoot }) {
  const installedPackages = await discoverInstalledPackages({ appRoot });
  const modules = [];
  for (const installedPackage of installedPackages) {
    if (!hasClientExport(installedPackage.packageJson)) {
      continue;
    }
    const packageMetadataSections = normalizeClientPackageMetadataSections(installedPackage.packageMetadata);

    modules.push(
      Object.freeze({
        packageId: installedPackage.packageId,
        sourceType: installedPackage.sourceType,
        packageMetadataUiRoutes: packageMetadataSections.packageMetadataUiRoutes,
        packageMetadataClientProviders: packageMetadataSections.packageMetadataClientProviders,
        packageMetadataClientOptimizeIncludeSpecifiers: packageMetadataSections.packageMetadataClientOptimizeIncludeSpecifiers,
        packageMetadataClientOptimizeExcludeSpecifiers: packageMetadataSections.packageMetadataClientOptimizeExcludeSpecifiers
      })
    );
  }

  return Object.freeze(modules);
}

async function resolveInstalledClientPackageIds(options) {
  const modules = await resolveInstalledClientModules(options);
  return Object.freeze(modules.map((entry) => entry.packageId));
}

async function resolveLocalScopePackageIds({ appRoot }) {
  const appPackageJson = await readJsonFile(path.resolve(appRoot, "package.json"), {});
  return Object.freeze(
    sortStrings(
      [...collectRootDependencySpecifiers(appPackageJson).keys()].filter((packageId) =>
        isLocalScopePackageId(packageId)
      )
    )
  );
}

function normalizeClientModulePackageMetadataEntries(value) {
  const items = Array.isArray(value) ? value : [];
  const packageMetadataEntries = [];

  for (const item of items) {
    const record = normalizeObject(item);
    const packageId = String(record.packageId || "").trim();
    if (!packageId) {
      continue;
    }
    const sourceType = String(record.sourceType || "").trim().toLowerCase();
    packageMetadataEntries.push({
      packageId,
      sourceType,
      packageMetadataUiRoutes: normalizePackageMetadataUiRoutes(record.packageMetadataUiRoutes),
      packageMetadataClientProviders: normalizePackageMetadataClientProviders(record.packageMetadataClientProviders),
      packageMetadataClientOptimizeIncludeSpecifiers: normalizePackageMetadataClientOptimizeSpecifiers(
        record.packageMetadataClientOptimizeIncludeSpecifiers
      ),
      packageMetadataClientOptimizeExcludeSpecifiers: normalizePackageMetadataClientOptimizeSpecifiers(
        record.packageMetadataClientOptimizeExcludeSpecifiers
      )
    });
  }

  return Object.freeze(
    packageMetadataEntries.sort((left, right) => left.packageId.localeCompare(right.packageId))
  );
}

function createVirtualModuleSource(clientModules = []) {
  const modulePackageMetadataEntries = normalizeClientModulePackageMetadataEntries(clientModules);
  const importLines = modulePackageMetadataEntries.map(
    (entry, index) => `import * as clientModule${index} from ${JSON.stringify(`${entry.packageId}/client`)};`
  );
  const moduleEntries = modulePackageMetadataEntries.map(
    (entry, index) =>
      `  { packageId: ${JSON.stringify(entry.packageId)}, module: clientModule${index}, packageMetadataUiRoutes: ${JSON.stringify(entry.packageMetadataUiRoutes)}, packageMetadataClientProviders: ${JSON.stringify(entry.packageMetadataClientProviders)} }`
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
  const modulePackageMetadataEntries = normalizeClientModulePackageMetadataEntries(clientModules);
  return sortStrings(
    [
      ...modulePackageMetadataEntries
        .filter((entry) => LOCAL_PACKAGE_SOURCE_TYPES.has(entry.sourceType))
        .flatMap((entry) => [entry.packageId, `${entry.packageId}/shared`, `${entry.packageId}/client`]),
      ...modulePackageMetadataEntries.flatMap((entry) => entry.packageMetadataClientOptimizeExcludeSpecifiers || [])
    ]
  );
}

function resolveClientOptimizeIncludeSpecifiers(clientModules = [], excludeSpecifiers = []) {
  const modulePackageMetadataEntries = normalizeClientModulePackageMetadataEntries(clientModules);
  const excluded = new Set(sortStrings(excludeSpecifiers));
  return sortStrings(
    [
      ...modulePackageMetadataEntries
      .filter((entry) => !LOCAL_PACKAGE_SOURCE_TYPES.has(entry.sourceType))
      .map((entry) => `${entry.packageId}/client`),
      ...modulePackageMetadataEntries.flatMap((entry) => entry.packageMetadataClientOptimizeIncludeSpecifiers || [])
    ].filter((specifier) => !excluded.has(specifier))
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

function createJskitClientBootstrapPlugin() {
  let appRoot = process.cwd();
  let localPackages = Object.freeze([]);
  let resolvePackageSpecifier = null;

  return {
    name: "jskit-client-bootstrap",
    // This must run before Vite's normal package resolver turns a local bare import into node_modules.
    enforce: "pre",
    async config(userConfig = {}) {
      appRoot = process.cwd();
      const clientModules = await resolveInstalledClientModules({
        appRoot
      });
      const localScopePackageIds = await resolveLocalScopePackageIds({
        appRoot
      });
      const userResolve = normalizeObject(userConfig.resolve);
      localPackages = await resolveLocalPackageSources({
        appRoot
      });
      const clientExcludeSpecifiers = resolveClientOptimizeExcludeSpecifiers(clientModules);
      const localScopeExcludeSpecifiers = resolveLocalScopeOptimizeExcludeSpecifiers(localScopePackageIds);
      const userOptimizeDeps = normalizeObject(userConfig.optimizeDeps);
      const userExclude = sortStrings(userOptimizeDeps.exclude);
      const userInclude = sortStrings(userOptimizeDeps.include);
      const exclude = sortStrings([...userExclude, ...clientExcludeSpecifiers, ...localScopeExcludeSpecifiers]);
      const clientIncludeSpecifiers = resolveClientOptimizeIncludeSpecifiers(clientModules, exclude);
      const include = sortStrings([...userInclude, ...clientIncludeSpecifiers].filter((specifier) => !exclude.includes(specifier)));
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
    configResolved(resolvedConfig) {
      // Do not use `this.resolve()` for this lookup. That re-enters Vite's live plugin chain, where
      // the dependency optimizer can turn an unlisted local subpath into node_modules/.vite (or add
      // its dependency ?v hash) before JSKIT sees the selected file. The config resolver applies the
      // app's aliases, exports conditions, and wildcard rules without registering an optimized dep.
      resolvePackageSpecifier = resolvedConfig.createResolver({ scan: true });
    },
    async resolveId(source, importer) {
      if (source === CLIENT_BOOTSTRAP_VIRTUAL_ID) {
        return CLIENT_BOOTSTRAP_RESOLVED_ID;
      }
      const localPackage = resolveLocalPackageForSpecifier(source, localPackages);
      if (!localPackage) {
        return null;
      }

      const resolvedId = await resolvePackageSpecifier?.(source, importer);
      if (!resolvedId) {
        return null;
      }

      const canonicalId = resolveCanonicalLocalPackageId(resolvedId, localPackage);
      if (!canonicalId) {
        return resolvedId;
      }

      // The canonical absolute path receives editable-source watching and no-cache headers.
      return canonicalId;
    },
    async load(id) {
      if (id !== CLIENT_BOOTSTRAP_RESOLVED_ID) {
        return null;
      }

      const clientModules = await resolveInstalledClientModules({
        appRoot
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
  resolveCanonicalLocalPackageId,
  resolveLocalPackageForSpecifier,
  resolveLocalPackageSources,
  resolveLocalScopeOptimizeExcludeSpecifiers,
  resolveInstalledClientPackageIds,
  resolveLocalScopePackageIds,
  resolveInstalledClientModules,
  createJskitClientBootstrapPlugin
};
