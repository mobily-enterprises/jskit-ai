import { access, constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveAppRootFrom(moduleDirectory) {
  let currentDirectory = path.resolve(moduleDirectory);

  while (true) {
    const candidateConfigPath = path.join(currentDirectory, "config", "public.js");
    if (await fileExists(candidateConfigPath)) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error("Unable to locate app root (missing config/public.js).");
    }
    currentDirectory = parentDirectory;
  }
}

async function loadConfigModule(absolutePath) {
  if (!(await fileExists(absolutePath))) {
    return {};
  }

  const loadedModule = await import(pathToFileURL(absolutePath).href);
  const loadedConfig = loadedModule?.config;
  return loadedConfig && typeof loadedConfig === "object" && !Array.isArray(loadedConfig) ? loadedConfig : {};
}

async function loadAppConfig({ moduleUrl = import.meta.url } = {}) {
  const moduleDirectory = path.dirname(fileURLToPath(moduleUrl));
  const appRoot = await resolveAppRootFrom(moduleDirectory);
  const [publicConfig, serverConfig] = await Promise.all([
    loadConfigModule(path.join(appRoot, "config", "public.js")),
    loadConfigModule(path.join(appRoot, "config", "server.js"))
  ]);

  return Object.freeze({
    ...publicConfig,
    ...serverConfig
  });
}

export { loadAppConfig };
