import { mkdirSync } from "node:fs";
import path from "node:path";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import memoryDriver from "unstorage/drivers/memory";

const STORAGE_DRIVER_ENV_KEY = "JSKIT_STORAGE_DRIVER";
const STORAGE_FS_BASE_PATH_ENV_KEY = "JSKIT_STORAGE_FS_BASE_PATH";
const DEFAULT_STORAGE_DRIVER = "fs";

function normalizeStorageDriver(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || DEFAULT_STORAGE_DRIVER;
}

/**
 * @param {string | undefined} fsBasePath
 * @param {object} [options]
 * @param {string} [options.rootDir]
 */
function resolveFsBasePath(fsBasePath, { rootDir } = {}) {
  const normalized = String(fsBasePath || "").trim();
  if (normalized) {
    return path.resolve(normalized);
  }

  const resolvedRootDir = rootDir || process.cwd();
  return path.resolve(resolvedRootDir, "data", "storage");
}

/**
 * The storage `runtime.storage` provides: unstorage over the driver the environment selects.
 * @param {object} [options]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} [options.env]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} [options.rootDir]
 */
function createStorageBinding({ env = {}, rootDir = process.cwd() } = {}) {
  const driver = normalizeStorageDriver(env?.[STORAGE_DRIVER_ENV_KEY]);

  if (driver === "memory") {
    return createStorage({
      driver: memoryDriver()
    });
  }

  if (driver !== "fs") {
    throw new Error(`Unsupported ${STORAGE_DRIVER_ENV_KEY} "${driver}". Supported: fs, memory.`);
  }

  const fsBasePath = resolveFsBasePath(env?.[STORAGE_FS_BASE_PATH_ENV_KEY], { rootDir });
  mkdirSync(fsBasePath, { recursive: true });

  return createStorage({
    driver: fsDriver({
      base: fsBasePath
    })
  });
}

export {
  STORAGE_DRIVER_ENV_KEY,
  STORAGE_FS_BASE_PATH_ENV_KEY,
  DEFAULT_STORAGE_DRIVER,
  normalizeStorageDriver,
  createStorageBinding
};
