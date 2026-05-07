import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fileExists } from "../../internal/node/fileSystem.js";

const PUBLIC_CONFIG_RELATIVE_PATH = "config/public.js";
const SERVER_CONFIG_RELATIVE_PATH = "config/server.js";

function normalizeConfigObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function resolveAppRootFromModuleUrl(
  moduleUrl,
  { publicConfigRelativePath = PUBLIC_CONFIG_RELATIVE_PATH } = {}
) {
  const moduleDirectory = path.dirname(fileURLToPath(moduleUrl));
  let currentDirectory = path.resolve(moduleDirectory);

  while (true) {
    const candidateConfigPath = path.join(currentDirectory, publicConfigRelativePath);
    if (await fileExists(candidateConfigPath)) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(`Unable to locate app root (missing ${publicConfigRelativePath}).`);
    }
    currentDirectory = parentDirectory;
  }
}

async function loadConfigModuleAtPath(absolutePath) {
  if (!(await fileExists(absolutePath))) {
    return {};
  }

  const loadedModule = await import(pathToFileURL(absolutePath).href);
  return normalizeConfigObject(loadedModule?.config);
}

async function loadAppConfigFromAppRoot({
  appRoot = "",
  publicConfigRelativePath = PUBLIC_CONFIG_RELATIVE_PATH,
  serverConfigRelativePath = SERVER_CONFIG_RELATIVE_PATH
} = {}) {
  const normalizedAppRootInput = String(appRoot || "").trim();
  if (!normalizedAppRootInput) {
    throw new Error("loadAppConfigFromAppRoot requires appRoot.");
  }
  const normalizedAppRoot = path.resolve(normalizedAppRootInput);

  const [publicConfig, serverConfig] = await Promise.all([
    loadConfigModuleAtPath(path.join(normalizedAppRoot, publicConfigRelativePath)),
    loadConfigModuleAtPath(path.join(normalizedAppRoot, serverConfigRelativePath))
  ]);

  return Object.freeze({
    ...publicConfig,
    ...serverConfig
  });
}

async function loadAppConfigFromModuleUrl({
  moduleUrl = import.meta.url,
  publicConfigRelativePath = PUBLIC_CONFIG_RELATIVE_PATH,
  serverConfigRelativePath = SERVER_CONFIG_RELATIVE_PATH
} = {}) {
  const appRoot = await resolveAppRootFromModuleUrl(moduleUrl, {
    publicConfigRelativePath
  });
  return loadAppConfigFromAppRoot({
    appRoot,
    publicConfigRelativePath,
    serverConfigRelativePath
  });
}

export { loadAppConfigFromAppRoot, loadAppConfigFromModuleUrl };
