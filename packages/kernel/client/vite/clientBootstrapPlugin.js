import { access, constants as fsConstants, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CLIENT_BOOTSTRAP_VIRTUAL_ID = "virtual:jskit-client-bootstrap";
const CLIENT_BOOTSTRAP_RESOLVED_ID = `\0${CLIENT_BOOTSTRAP_VIRTUAL_ID}`;

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePackageIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function normalizeUiRoutePath(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue || !rawValue.startsWith("/") || rawValue.startsWith("//")) {
    return "";
  }

  const normalized = rawValue.replace(/\/{2,}/g, "/");
  if (normalized === "/") {
    return "/";
  }
  return normalized.replace(/\/+$/, "") || "/";
}

function normalizeDescriptorUiRoutes(routeEntries = []) {
  const entries = ensureArray(routeEntries);
  const normalizedRoutes = [];

  for (const rawRoute of entries) {
    const route = ensureObject(rawRoute);
    const pathValue = normalizeUiRoutePath(route.path);
    if (!pathValue) {
      continue;
    }

    const routeName = String(route.name || "").trim();
    const routeId = String(route.id || routeName || pathValue).trim();
    const scope = String(route.scope || "surface")
      .trim()
      .toLowerCase();
    if (scope !== "global" && scope !== "surface") {
      continue;
    }

    const componentKey = String(route.componentKey || routeName || routeId || "").trim();
    const purpose = String(route.purpose || "").trim();
    const autoRegister = route.autoRegister !== false;
    const surface = String(route.surface || "")
      .trim()
      .toLowerCase();
    const guard = ensureObject(route.guard);

    normalizedRoutes.push(
      Object.freeze({
        id: routeId,
        name: routeName,
        path: pathValue,
        scope,
        ...(surface ? { surface } : {}),
        ...(componentKey ? { componentKey } : {}),
        ...(Object.keys(guard).length > 0 ? { guard } : {}),
        ...(purpose ? { purpose } : {}),
        autoRegister
      })
    );
  }

  return Object.freeze(normalizedRoutes);
}

async function readJsonFile(filePath, fallback) {
  try {
    const source = await readFile(filePath, "utf8");
    return JSON.parse(source);
  } catch {
    return fallback;
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function hasClientExport(packageJson) {
  const exportsMap = ensureObject(packageJson?.exports);
  return Boolean(exportsMap["./client"]);
}

async function resolveDescriptorPathForInstalledPackage({ appRoot, packageId, installedPackageState }) {
  const descriptorPathFromSource = String(installedPackageState?.source?.descriptorPath || "").trim();
  const jskitCliRoot = path.resolve(appRoot, "node_modules", "@jskit-ai", "jskit-cli");

  const candidatePaths = [path.resolve(appRoot, "node_modules", packageId, "package.descriptor.mjs")];
  if (descriptorPathFromSource) {
    candidatePaths.push(path.resolve(appRoot, descriptorPathFromSource));
    candidatePaths.push(path.resolve(jskitCliRoot, descriptorPathFromSource));
  }

  for (const candidatePath of candidatePaths) {
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return "";
}

async function loadDescriptorUiRoutes({ appRoot, packageId, installedPackageState }) {
  const descriptorPath = await resolveDescriptorPathForInstalledPackage({
    appRoot,
    packageId,
    installedPackageState
  });
  if (!descriptorPath) {
    return Object.freeze([]);
  }

  try {
    const descriptorModule = await import(pathToFileURL(descriptorPath).href + `?t=${Date.now()}_${Math.random()}`);
    const descriptor = ensureObject(descriptorModule?.default);
    const metadata = ensureObject(descriptor.metadata);
    const uiMetadata = ensureObject(metadata.ui);
    return normalizeDescriptorUiRoutes(uiMetadata.routes);
  } catch {
    return Object.freeze([]);
  }
}

async function resolveInstalledClientModules({ appRoot, lockPath }) {
  const absoluteLockPath = path.resolve(appRoot, lockPath);
  const lockPayload = await readJsonFile(absoluteLockPath, {});
  const installedPackages = ensureObject(lockPayload.installedPackages);
  const packageIds = normalizePackageIds(Object.keys(installedPackages));

  const modules = [];
  for (const packageId of packageIds) {
    const packageJsonPath = path.resolve(appRoot, "node_modules", ...packageId.split("/"), "package.json");
    const packageJson = await readJsonFile(packageJsonPath, {});
    if (!hasClientExport(packageJson)) {
      continue;
    }

    const descriptorRoutes = await loadDescriptorUiRoutes({
      appRoot,
      packageId,
      installedPackageState: ensureObject(installedPackages[packageId])
    });

    modules.push(
      Object.freeze({
        packageId,
        descriptorRoutes
      })
    );
  }

  return Object.freeze(modules);
}

async function resolveInstalledClientPackageIds(options) {
  const modules = await resolveInstalledClientModules(options);
  return Object.freeze(modules.map((entry) => entry.packageId));
}

function normalizeClientModuleDescriptors(value) {
  const items = Array.isArray(value) ? value : [];
  const descriptors = [];

  for (const item of items) {
    if (typeof item === "string") {
      const packageId = String(item || "").trim();
      if (!packageId) {
        continue;
      }
      descriptors.push({ packageId, descriptorRoutes: [] });
      continue;
    }

    const record = ensureObject(item);
    const packageId = String(record.packageId || "").trim();
    if (!packageId) {
      continue;
    }
    descriptors.push({
      packageId,
      descriptorRoutes: normalizeDescriptorUiRoutes(record.descriptorRoutes)
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
      `  { packageId: ${JSON.stringify(entry.packageId)}, module: clientModule${index}, descriptorRoutes: ${JSON.stringify(entry.descriptorRoutes)} }`
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

function createJskitClientBootstrapPlugin({ lockPath = ".jskit/lock.json" } = {}) {
  return {
    name: "jskit-client-bootstrap",
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
  normalizeDescriptorUiRoutes,
  resolveInstalledClientPackageIds,
  resolveInstalledClientModules,
  createJskitClientBootstrapPlugin
};
