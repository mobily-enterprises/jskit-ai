import { access, constants as fsConstants, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CLIENT_BOOTSTRAP_VIRTUAL_ID = "virtual:jskit-client-bootstrap";
const CLIENT_BOOTSTRAP_RESOLVED_ID = `\0${CLIENT_BOOTSTRAP_VIRTUAL_ID}`;

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizePackageIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
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

function normalizeDescriptorUiRoutes(value) {
  const routeEntries = Array.isArray(value) ? value : [];
  const normalizedRoutes = [];

  for (const routeEntry of routeEntries) {
    const routeRecord = ensureObject(routeEntry);
    if (Object.keys(routeRecord).length < 1) {
      continue;
    }

    try {
      normalizedRoutes.push(Object.freeze(JSON.parse(JSON.stringify(routeRecord))));
    } catch {
      continue;
    }
  }

  return Object.freeze(normalizedRoutes);
}

async function resolveDescriptorPathForInstalledPackage({ appRoot, packageId, installedPackageState }) {
  const descriptorPathFromSource = String(installedPackageState?.source?.descriptorPath || "").trim();
  const packagePathFromSource = String(installedPackageState?.source?.packagePath || "").trim();
  const jskitRoot = path.join(appRoot, "node_modules", "@jskit-ai", "jskit-cli");
  const candidatePaths = [path.resolve(appRoot, "node_modules", packageId, "package.descriptor.mjs")];
  if (packagePathFromSource) {
    candidatePaths.push(path.resolve(appRoot, packagePathFromSource, "package.descriptor.mjs"));
  }
  if (descriptorPathFromSource) {
    candidatePaths.push(path.resolve(appRoot, descriptorPathFromSource));
    candidatePaths.push(path.resolve(jskitRoot, descriptorPathFromSource));
  }

  for (const candidatePath of candidatePaths) {
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return "";
}

async function resolveDescriptorUiRoutes({ appRoot, packageId, installedPackageState }) {
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
    return normalizeDescriptorUiRoutes(descriptor?.metadata?.ui?.routes);
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
    const installedPackageState = ensureObject(installedPackages[packageId]);
    const packageJsonPath = path.resolve(appRoot, "node_modules", ...packageId.split("/"), "package.json");
    const packageJson = await readJsonFile(packageJsonPath, {});
    if (!hasClientExport(packageJson)) {
      continue;
    }

    const descriptorUiRoutes = await resolveDescriptorUiRoutes({
      appRoot,
      packageId,
      installedPackageState
    });

    modules.push(
      Object.freeze({
        packageId,
        descriptorUiRoutes
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
    const record = ensureObject(item);
    const packageId = String(record.packageId || "").trim();
    if (!packageId) {
      continue;
    }
    descriptors.push({
      packageId,
      descriptorUiRoutes: normalizeDescriptorUiRoutes(record.descriptorUiRoutes)
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
      `  { packageId: ${JSON.stringify(entry.packageId)}, module: clientModule${index}, descriptorUiRoutes: ${JSON.stringify(entry.descriptorUiRoutes)} }`
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
  resolveInstalledClientPackageIds,
  resolveInstalledClientModules,
  createJskitClientBootstrapPlugin
};
