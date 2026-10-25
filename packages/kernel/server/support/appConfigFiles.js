import path from "node:path";
import { fileExists } from "../../internal/node/fileSystem.js";
import { importFreshModuleFromAbsolutePath } from "./importFreshModuleFromAbsolutePath.js";

const PUBLIC_CONFIG_RELATIVE_PATH = "config/public.js";
const SERVER_CONFIG_RELATIVE_PATH = "config/server.js";

function normalizeConfigObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function loadConfigModuleAtPath(absolutePath) {
  if (!(await fileExists(absolutePath))) {
    return {};
  }

  const loadedModule = await importFreshModuleFromAbsolutePath(absolutePath);
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

export { loadAppConfigFromAppRoot };
