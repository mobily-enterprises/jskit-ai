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

    modules.push(
      Object.freeze({
        packageId
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
    descriptors.push({ packageId });
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
      `  { packageId: ${JSON.stringify(entry.packageId)}, module: clientModule${index} }`
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
