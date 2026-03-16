import { mkdirSync } from "node:fs";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import memoryDriver from "unstorage/drivers/memory";
import { KERNEL_TOKENS } from "../../shared/support/tokens.js";
import { resolveFsBasePath } from "./storagePaths.js";

const STORAGE_DRIVER_ENV_KEY = "JSKIT_STORAGE_DRIVER";
const STORAGE_FS_BASE_PATH_ENV_KEY = "JSKIT_STORAGE_FS_BASE_PATH";
const DEFAULT_STORAGE_DRIVER = "fs";

function normalizeStorageDriver(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || DEFAULT_STORAGE_DRIVER;
}

function createStorageBinding(scope, { rootDir = process.cwd() } = {}) {
  const env = scope && typeof scope.has === "function" && scope.has(KERNEL_TOKENS.Env) ? scope.make(KERNEL_TOKENS.Env) : {};
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
