import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  collectRootDependencySpecifiers,
  discoverInstalledPackages
} from "../../internal/node/installedPackages.js";
import { CLIENT_BUILD_META_NAME } from "../../shared/support/clientBuild.js";
import { APP_ENVIRONMENT_META_NAME, appEnvironment } from "../../shared/support/appEnvironment.js";
import { isRecord, normalizeObject } from "../../shared/support/normalize.js";
import { sortStrings } from "../../shared/support/sorting.js";
import {
  normalizePackageMetadataClientProviders,
  normalizePackageMetadataClientOptimizeSpecifiers,
  normalizePackageMetadataUiRoutes,
  normalizeClientPackageMetadataSections
} from "../packageMetadataSections.js";

const CLIENT_BOOTSTRAP_VIRTUAL_ID = "virtual:jskit-client-bootstrap";
const CLIENT_BOOTSTRAP_RESOLVED_ID = `\0${CLIENT_BOOTSTRAP_VIRTUAL_ID}`;
const CLIENT_BOOTSTRAP_MODULE_SPECIFIER = "@jskit-ai/kernel/client/moduleBootstrap";
const CLIENT_I18N_MODULE_SPECIFIER = "@jskit-ai/kernel/client/i18n";
const LOCALE_CATALOG_EXPORT = "./locales/en.json";
const CLIENT_RUNTIME_DEDUPE_SPECIFIERS = Object.freeze([
  "@tanstack/vue-query",
  "pinia",
  "vue",
  "vue-router",
  "vuetify"
]);
const LOCAL_PACKAGE_SOURCE_TYPES = new Set(["local-package", "app-local-package"]);
// Vuetify's cascade layers in its own order (vuetify/lib/styles/layers.css). A layer's place is fixed where it is
// first named, and a production build links the CSS of shared component chunks, each opening with
// @layer vuetify-components, before the entry's vuetify/styles: vuetify-components would come first, and Vuetify's
// reset (button, input, select, textarea { font: inherit }) would beat its component styles. Named at the top of the
// page, before any stylesheet, the order holds however the build links them.
const VUETIFY_LAYER_ORDER = "@layer vuetify-core.reset, vuetify-core.base, vuetify-components, vuetify-overrides, " +
  "vuetify-utilities.theme-base, vuetify-utilities.typography, vuetify-utilities.helpers, " +
  "vuetify-utilities.theme-background, vuetify-utilities.theme-foreground, vuetify-final.transitions, vuetify-final.trumps;";

// Every cascade layer a stylesheet names, in the order it names them, as dotted paths with their parents first
// ("vuetify-core", "vuetify-core.reset").
function namedCascadeLayers(css) {
  const names = [];
  const blocks = [];
  const add = (name) => {
    const parts = [...blocks.filter(Boolean), ...name.trim().split(".")];
    parts.forEach((part, index) => names.push(parts.slice(0, index + 1).join(".")));
  };
  for (const [token, list, opener] of String(css).replace(/\/\*[\s\S]*?\*\//gu, "").matchAll(/@layer\s+([^;{}]+?)\s*([;{])|[{}]/gu)) {
    if (token === "}") {
      blocks.pop();
    } else if (token === "{") {
      blocks.push(null);
    } else if (opener === "{") {
      add(list);
      blocks.push(list.trim());
    } else {
      list.split(",").forEach(add);
    }
  }
  // A layer's first mention places it; later ones add nothing.
  return [...new Set(names)];
}

// Where a built page's stylesheets put Vuetify's layers: its <style> and stylesheet <link> contents in page order,
// then the stylesheets it loads later. Returns a message when that is not Vuetify's order, or "".
function checkVuetifyLayerOrder(stylesheets = []) {
  const expected = namedCascadeLayers(VUETIFY_LAYER_ORDER);
  const built = [...new Set(stylesheets.flatMap(namedCascadeLayers).filter((name) => name.startsWith("vuetify")))];
  if (built.join() === expected.join()) {
    return "";
  }
  return `The built page puts Vuetify's cascade layers in the order ${built.join(", ")}; ` +
    `Vuetify's own is ${expected.join(", ")}. Every button and field then loses its Material 3 type.`;
}

// The built pages' stylesheets, each page's in its own order, then the CSS the pages load later.
function builtPageStylesheets(bundle) {
  const assets = Object.values(bundle).filter(({ type }) => type === "asset");
  const pages = assets.filter(({ fileName }) => fileName.endsWith(".html"));
  const css = assets.filter(({ fileName }) => fileName.endsWith(".css"));
  return pages.map((page) => {
    const linked = [];
    const inPage = [];
    for (const [tag, inline] of String(page.source).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>|<link\b[^>]*>/gu)) {
      if (tag.startsWith("<style")) {
        inPage.push(inline);
        continue;
      }
      const href = /\brel=["']?stylesheet\b/u.test(tag) ? /\bhref=["']?([^"' >]+)/u.exec(tag)?.[1] : "";
      const asset = href ? css.find(({ fileName }) => href === fileName || href.endsWith(`/${fileName}`)) : null;
      if (asset) {
        linked.push(asset);
        inPage.push(String(asset.source));
      }
    }
    return { page: page.fileName, stylesheets: [...inPage, ...css.filter((asset) => !linked.includes(asset)).map(({ source }) => String(source))] };
  });
}

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

// Every installed package's English catalog, including server-only packages, so
// the client can render the codes their errors carry.
function resolveLocalePackageIds(installedPackages = []) {
  return sortStrings(installedPackages
    .filter((installedPackage) => normalizeObject(installedPackage.packageJson?.exports)[LOCALE_CATALOG_EXPORT])
    .map((installedPackage) => installedPackage.packageId));
}

function isPathInsideRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath))
  );
}

/**
 * Vite's default real-path resolution keeps linked packages on editable application source. This
 * table is a fallback for declared file dependencies when another resolver still returns their
 * installed node_modules identity. optimizeDeps.exclude alone does not prevent Vite from appending
 * a dependency version token and assigning one-year immutable browser caching.
 *
 * Include every declared file dependency, not only packages with a client export. A local client can
 * import another local package's root, shared entry, or exported subpath and accidentally re-enter
 * node_modules caching.
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

// The one file a package export names whatever the conditions besides types, or "" when conditions choose between
// files.
function exportFile(target) {
  if (typeof target === "string") {
    return path.posix.normalize(target);
  }
  if (!isRecord(target)) {
    return "";
  }
  const files = new Set(Object.entries(target)
    .filter(([condition]) => condition !== "types")
    .map(([, value]) => exportFile(value)));
  return files.size === 1 ? [...files][0] : "";
}

// The bootstrap loads on every page, so it imports from a package only what it uses: each client provider through
// the subpath export that names the provider's own file. The package's ./client barrel, and every screen it
// re-exports (users-web's account settings with its image editor, say), then loads only with the pages that import
// it. The bootstrap still imports the whole barrel when it reads more of it, as before: routeComponents for the
// package's ui routes, a clientRoutes export, or a provider no subpath exports; and when it cannot tell, for a
// barrel it cannot read, one with export *, or one whose export conditions choose between files. Returns
// { barrel: true } or the providers.
async function resolveClientBootImports(installedPackage, { packageMetadataUiRoutes, packageMetadataClientProviders }) {
  const barrel = Object.freeze({ barrel: true });
  const exportsMap = normalizeObject(installedPackage.packageJson?.exports);
  const barrelFile = exportFile(exportsMap["./client"]);
  if (packageMetadataUiRoutes.length > 0 || !barrelFile) {
    return barrel;
  }
  let barrelSource = "";
  try {
    barrelSource = await readFile(path.resolve(installedPackage.packageRoot, barrelFile), "utf8");
  } catch {
    return barrel;
  }
  // A module's exports are named in its own text, except through export *.
  if (/\b(?:routeComponents|clientRoutes)\b|\bexport\s*\*/u.test(barrelSource)) {
    return barrel;
  }
  const providers = [];
  for (const { export: exportName, entrypoint } of packageMetadataClientProviders) {
    const subpath = Object.keys(exportsMap).find((key) =>
      !key.includes("*") && exportFile(exportsMap[key]) === path.posix.normalize(`./${entrypoint}`));
    if (!subpath || !/^[A-Za-z_$][\w$]*$/u.test(exportName)) {
      return barrel;
    }
    providers.push(Object.freeze({
      export: exportName,
      specifier: `${installedPackage.packageId}${subpath.slice(1)}`
    }));
  }
  return Object.freeze({
    barrel: false,
    providers: Object.freeze(providers)
  });
}

async function resolveClientModulesFromInstalledPackages(installedPackages = []) {
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
        packageMetadataClientOptimizeExcludeSpecifiers: packageMetadataSections.packageMetadataClientOptimizeExcludeSpecifiers,
        bootImports: await resolveClientBootImports(installedPackage, packageMetadataSections)
      })
    );
  }

  return Object.freeze(modules);
}

async function resolveInstalledClientModules({ appRoot }) {
  return resolveClientModulesFromInstalledPackages(
    await discoverInstalledPackages({ appRoot })
  );
}

function resolveInstalledViteProxyEntries(installedPackages = [], { proxyTarget = "" } = {}) {
  const fallbackTarget = String(proxyTarget || "").trim();
  const proxyEntries = {};
  const ownerByPath = new Map();

  for (const installedPackage of [...installedPackages].sort((left, right) =>
    String(left?.packageId || "").localeCompare(String(right?.packageId || "")))) {
    const packageId = String(installedPackage?.packageId || "").trim();
    const vite = installedPackage?.packageMetadata?.vite;
    if (vite == null) {
      continue;
    }
    if (!isRecord(vite) || (vite.proxy != null && !isRecord(vite.proxy))) {
      throw new Error(`${packageId} package.json#jskit.vite.proxy must be an object.`);
    }
    const proxy = normalizeObject(vite.proxy);

    for (const routePath of sortStrings(Object.keys(proxy))) {
      if (!routePath.startsWith("/") || routePath.startsWith("//")) {
        throw new Error(`Vite proxy path ${JSON.stringify(routePath)} from ${packageId} must start with one "/".`);
      }
      if (ownerByPath.has(routePath)) {
        throw new Error(
          `Vite proxy path ${JSON.stringify(routePath)} is declared by both ${ownerByPath.get(routePath)} and ${packageId}.`
        );
      }

      const config = proxy[routePath];
      if (!isRecord(config)) {
        throw new Error(
          `Vite proxy path ${JSON.stringify(routePath)} from ${packageId} must be an object.`
        );
      }
      const unknownFields = Object.keys(config)
        .filter((field) => !["changeOrigin", "target", "ws"].includes(field))
        .sort();
      if (unknownFields.length > 0) {
        throw new Error(
          `Vite proxy path ${JSON.stringify(routePath)} from ${packageId} has unsupported ${unknownFields.length === 1 ? "field" : "fields"}: ${unknownFields.join(", ")}.`
        );
      }
      for (const field of ["changeOrigin", "ws"]) {
        if (Object.hasOwn(config, field) && typeof config[field] !== "boolean") {
          throw new Error(
            `Vite proxy path ${JSON.stringify(routePath)} from ${packageId} requires ${field} to be boolean.`
          );
        }
      }
      if (Object.hasOwn(config, "target") && typeof config.target !== "string") {
        throw new Error(
          `Vite proxy path ${JSON.stringify(routePath)} from ${packageId} requires target to be a string.`
        );
      }

      const target = String(config.target || "").trim() || fallbackTarget;
      if (!target) {
        throw new Error(
          `Vite proxy path ${JSON.stringify(routePath)} from ${packageId} requires target or createJskitClientBootstrapPlugin({ proxyTarget }).`
        );
      }

      ownerByPath.set(routePath, packageId);
      proxyEntries[routePath] = {
        target,
        ...(Object.hasOwn(config, "changeOrigin") ? { changeOrigin: config.changeOrigin === true } : {}),
        ...(Object.hasOwn(config, "ws") ? { ws: config.ws === true } : {})
      };
    }
  }

  return proxyEntries;
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
      ),
      bootProviders: normalizeBootProviders(record.bootImports)
    });
  }

  return Object.freeze(
    packageMetadataEntries.sort((left, right) => left.packageId.localeCompare(right.packageId))
  );
}

// The providers the bootstrap imports by their own subpaths, or null when it imports the package's ./client barrel.
function normalizeBootProviders(bootImports) {
  const record = normalizeObject(bootImports);
  if (record.barrel !== false || !Array.isArray(record.providers)) {
    return null;
  }
  return record.providers.map((provider) => ({
    export: String(provider?.export || ""),
    specifier: String(provider?.specifier || "")
  }));
}

// What the bootstrap imports from a package, for the development server to prepare: its ./client barrel, which the
// app's pages may import, and the provider subpaths the bootstrap imports instead of it.
function clientBootSpecifiers(entry) {
  return [`${entry.packageId}/client`, ...(entry.bootProviders || []).map(({ specifier }) => specifier)];
}

function createVirtualModuleSource(clientModules, localePackageIds) {
  const modulePackageMetadataEntries = normalizeClientModulePackageMetadataEntries(clientModules);
  const importLines = [];
  const moduleSources = modulePackageMetadataEntries.map((entry, index) => {
    if (!entry.bootProviders) {
      importLines.push(`import * as clientModule${index} from ${JSON.stringify(`${entry.packageId}/client`)};`);
      return `clientModule${index}`;
    }
    // A namespace read by name keeps the rest of the provider's module out, and a missing export reaches the
    // bootstrap's own message as undefined.
    const namespaces = new Map();
    const members = entry.bootProviders.map(({ export: exportName, specifier }) => {
      if (!namespaces.has(specifier)) {
        namespaces.set(specifier, `clientProviders${index}_${namespaces.size}`);
        importLines.push(`import * as ${namespaces.get(specifier)} from ${JSON.stringify(specifier)};`);
      }
      return `${exportName}: ${namespaces.get(specifier)}.${exportName}`;
    });
    return `Object.freeze({${members.length > 0 ? ` ${members.join(", ")} ` : ""}})`;
  });
  if (localePackageIds.length > 0) {
    importLines.push(
      ...localePackageIds.map((packageId, index) =>
        `import localeCatalog${index} from ${JSON.stringify(`${packageId}/locales/en.json`)} with { type: "json" };`),
      `import { registerJskitMessages } from ${JSON.stringify(CLIENT_I18N_MODULE_SPECIFIER)};`,
      "",
      `[${localePackageIds.map((_, index) => `localeCatalog${index}`).join(", ")}].forEach(registerJskitMessages);`
    );
  }
  const moduleEntries = modulePackageMetadataEntries.map(
    (entry, index) =>
      `  { packageId: ${JSON.stringify(entry.packageId)}, module: ${moduleSources[index]}, packageMetadataUiRoutes: ${JSON.stringify(entry.packageMetadataUiRoutes)}, packageMetadataClientProviders: ${JSON.stringify(entry.packageMetadataClientProviders)} }`
  );

  const entriesSource = moduleEntries.length > 0 ? moduleEntries.join(",\n") : "";

  return `${importLines.join("\n")}${importLines.length > 0 ? "\n\n" : ""}import { bootClientModules } from ${JSON.stringify(CLIENT_BOOTSTRAP_MODULE_SPECIFIER)};

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

// Explicit package exclusions remain separate from mutable local source resolution.
function resolveClientOptimizeExcludeSpecifiers(clientModules = []) {
  const modulePackageMetadataEntries = normalizeClientModulePackageMetadataEntries(clientModules);
  return sortStrings(
    modulePackageMetadataEntries.flatMap((entry) => entry.packageMetadataClientOptimizeExcludeSpecifiers || [])
  );
}

function resolveClientOptimizeIncludeSpecifiers(clientModules = [], excludeSpecifiers = []) {
  const modulePackageMetadataEntries = normalizeClientModulePackageMetadataEntries(clientModules);
  const excluded = new Set(sortStrings(excludeSpecifiers));
  return sortStrings(
    [
      ...modulePackageMetadataEntries
      .filter((entry) => !LOCAL_PACKAGE_SOURCE_TYPES.has(entry.sourceType))
      .flatMap(clientBootSpecifiers),
      ...modulePackageMetadataEntries.flatMap((entry) => entry.packageMetadataClientOptimizeIncludeSpecifiers || [])
    ].filter((specifier) => !excluded.has(specifier))
  );
}

function resolveClientRuntimeDedupeSpecifiers(userResolveConfig = {}) {
  const resolveConfig = normalizeObject(userResolveConfig);
  const userDedupe = sortStrings(resolveConfig.dedupe);
  return sortStrings([...userDedupe, ...CLIENT_RUNTIME_DEDUPE_SPECIFIERS]);
}

function createJskitClientBootstrapPlugin({ proxyTarget = "" } = {}) {
  let appRoot = process.cwd();
  let hasMutableLocalPackages = false;
  let localPackages = Object.freeze([]);
  let resolvePackageSpecifier = null;
  let clientScanSpecifiers = [];

  async function config(userConfig = {}) {
    appRoot = process.cwd();
    const installedPackages = await discoverInstalledPackages({ appRoot });
    const clientModules = await resolveClientModulesFromInstalledPackages(installedPackages);
    const installedProxyEntries = resolveInstalledViteProxyEntries(installedPackages, {
      proxyTarget
    });
    const localScopePackageIds = await resolveLocalScopePackageIds({
      appRoot
    });
    const userResolve = normalizeObject(userConfig.resolve);
    localPackages = await resolveLocalPackageSources({
      appRoot
    });
    hasMutableLocalPackages = (
      localPackages.length > 0 ||
      localScopePackageIds.length > 0 ||
      installedPackages.some((entry) => LOCAL_PACKAGE_SOURCE_TYPES.has(entry.sourceType))
    );
    const clientExcludeSpecifiers = resolveClientOptimizeExcludeSpecifiers(clientModules);
    const userOptimizeDeps = normalizeObject(userConfig.optimizeDeps);
    const userExclude = sortStrings(userOptimizeDeps.exclude);
    const userInclude = sortStrings(userOptimizeDeps.include);
    const declaredExclude = sortStrings([
      ...userExclude,
      ...clientExcludeSpecifiers
    ]);
    // A provider the bootstrap imports by its own subpath stays source when its package's client entry does
    // (shell-web's provider loads the app's /src modules), or Vite would prebundle a second copy of it.
    const exclude = sortStrings([
      ...declaredExclude,
      ...normalizeClientModulePackageMetadataEntries(clientModules)
        .filter((entry) => declaredExclude.includes(`${entry.packageId}/client`))
        .flatMap(clientBootSpecifiers)
    ]);
    const clientIncludeSpecifiers = resolveClientOptimizeIncludeSpecifiers(clientModules, exclude);
    const include = sortStrings([
      ...userInclude,
      ...clientIncludeSpecifiers,
      CLIENT_BOOTSTRAP_MODULE_SPECIFIER
    ].filter((specifier) => !exclude.includes(specifier)));
    // Vite cannot crawl the virtual bootstrap. Local and explicitly excluded clients
    // still need scanning so their npm imports are ready before the first page loads.
    clientScanSpecifiers = normalizeClientModulePackageMetadataEntries(clientModules)
      .flatMap(clientBootSpecifiers)
      .filter((specifier) => !include.includes(specifier));
    const dedupe = resolveClientRuntimeDedupeSpecifiers(userResolve);
    const userServer = normalizeObject(userConfig.server);
    const userProxyEntries = normalizeObject(userServer.proxy);

    return {
      // A development log stays readable: a restart would otherwise wipe what came before it.
      clearScreen: userConfig.clearScreen ?? false,
      optimizeDeps: {
        ...userOptimizeDeps,
        include,
        exclude
      },
      resolve: {
        ...userResolve,
        ...(hasMutableLocalPackages ? { preserveSymlinks: false } : {}),
        dedupe
      },
      server: {
        proxy: {
          ...installedProxyEntries,
          ...userProxyEntries
        }
      }
    };
  }

  async function configResolved(resolvedConfig) {
    if (hasMutableLocalPackages && resolvedConfig.resolve?.preserveSymlinks === true) {
      throw new Error(
        "JSKIT mutable local packages require Vite real-path resolution. Remove resolve.preserveSymlinks: true."
      );
    }
    // Do not use `this.resolve()` for this lookup. That re-enters Vite's live plugin chain, where
    // the dependency optimizer can turn an unlisted local subpath into node_modules/.vite (or add
    // its dependency ?v hash) before JSKIT sees the selected file. The config resolver applies the
    // app's aliases, exports conditions, and wildcard rules without registering an optimized dep.
    resolvePackageSpecifier = resolvedConfig.createResolver({ scan: true });
    if (clientScanSpecifiers.length === 0) {
      return;
    }
    const clientEntries = await Promise.all(clientScanSpecifiers.map(async (specifier) => {
      const entry = await resolvePackageSpecifier(specifier, path.join(appRoot, "package.json"));
      if (!entry) {
        throw new Error(`Cannot resolve JSKIT client dependency scan entry ${specifier}.`);
      }
      const localPackage = resolveLocalPackageForSpecifier(specifier, localPackages);
      return localPackage ? resolveCanonicalLocalPackageId(entry, localPackage) || entry : entry;
    }));
    const optimizeDeps = resolvedConfig.environments.client.optimizeDeps;
    const input = resolvedConfig.environments.client.input ?? resolvedConfig.build.rolldownOptions.input;
    const entries = optimizeDeps.entries ?? (input
      ? (typeof input === "string" || Array.isArray(input) ? input : Object.values(input))
      : ["**/*.html", "!**/__tests__/**", "!**/coverage/**"]);
    const scanEntries = sortStrings([
      ...(Array.isArray(entries) ? entries : [entries]),
      ...clientEntries
    ]);
    optimizeDeps.entries = scanEntries;
    resolvedConfig.optimizeDeps.entries = scanEntries;
  }

  async function resolveId(source, importer) {
    if (source === CLIENT_BOOTSTRAP_VIRTUAL_ID) {
      return CLIENT_BOOTSTRAP_RESOLVED_ID;
    }
    const localPackage = resolveLocalPackageForSpecifier(source, localPackages);
    if (!localPackage) {
      return null;
    }

    const resolvedId = await resolvePackageSpecifier(source, importer);
    if (!resolvedId) {
      return null;
    }

    const canonicalId = resolveCanonicalLocalPackageId(resolvedId, localPackage);
    if (!canonicalId) {
      return resolvedId;
    }

    // The canonical absolute path receives editable-source watching and no-cache headers.
    return canonicalId;
  }

  async function load(id) {
    if (id !== CLIENT_BOOTSTRAP_RESOLVED_ID) {
      return null;
    }

    const installedPackages = await discoverInstalledPackages({ appRoot });
    return createVirtualModuleSource(
      await resolveClientModulesFromInstalledPackages(installedPackages),
      resolveLocalePackageIds(installedPackages)
    );
  }

  return Object.freeze({
    name: "jskit-client-bootstrap",
    // This must run before Vite's normal package resolver turns a local bare import into node_modules.
    enforce: "pre",
    config,
    configResolved,
    resolveId,
    load,
    generateBundle: {
      // After Vite emits the pages. A build whose pages would put Vuetify's layers out of order fails here, instead
      // of shipping buttons and fields that lost their type.
      order: "post",
      handler(outputOptions, bundle) {
        for (const { page, stylesheets } of builtPageStylesheets(bundle)) {
          const problem = checkVuetifyLayerOrder(stylesheets);
          if (problem) {
            this.error(`${page}: ${problem}`);
          }
        }
      }
    },
    transformIndexHtml: {
      // After Vite adds the page's script and style tags. Their content-hashed
      // names change whenever any built code or style does, so the page's
      // build id is a digest of the page itself. The layer order goes first in
      // every page, built or served in development. A page the development
      // server sends names its APP_ENV, as the JSKIT server does for the pages
      // it sends, and refuses without one, naming the fix; a built page names
      // none, since the server that sends it supplies its own.
      order: "post",
      handler(html, { bundle } = {}) {
        const layerOrder = { tag: "style", children: VUETIFY_LAYER_ORDER, injectTo: "head-prepend" };
        if (!bundle) {
          const environment = { name: APP_ENVIRONMENT_META_NAME, content: appEnvironment(process.env) };
          return [layerOrder, { tag: "meta", attrs: environment, injectTo: "head-prepend" }];
        }
        const buildId = createHash("sha256").update(html).digest("hex").slice(0, 16);
        return [layerOrder, { tag: "meta", attrs: { name: CLIENT_BUILD_META_NAME, content: buildId }, injectTo: "head-prepend" }];
      }
    }
  });
}

export {
  VUETIFY_LAYER_ORDER,
  namedCascadeLayers,
  checkVuetifyLayerOrder,
  CLIENT_BOOTSTRAP_VIRTUAL_ID,
  CLIENT_BOOTSTRAP_RESOLVED_ID,
  createVirtualModuleSource,
  resolveLocalePackageIds,
  resolveClientOptimizeIncludeSpecifiers,
  resolveClientOptimizeExcludeSpecifiers,
  resolveCanonicalLocalPackageId,
  resolveLocalPackageForSpecifier,
  resolveLocalPackageSources,
  resolveLocalScopePackageIds,
  resolveInstalledClientModules,
  resolveInstalledViteProxyEntries,
  createJskitClientBootstrapPlugin
};
