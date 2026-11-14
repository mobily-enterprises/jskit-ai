import { mkdirSync } from "node:fs";
import path from "node:path";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import memoryDriver from "unstorage/drivers/memory";
import s3Driver from "unstorage/drivers/s3";

const STORAGE_DRIVER_ENV_KEY = "JSKIT_STORAGE_DRIVER";
const STORAGE_FS_BASE_PATH_ENV_KEY = "JSKIT_STORAGE_FS_BASE_PATH";
const STORAGE_S3_BUCKET_ENV_KEY = "JSKIT_STORAGE_S3_BUCKET";
const STORAGE_S3_REGION_ENV_KEY = "JSKIT_STORAGE_S3_REGION";
const STORAGE_S3_ENDPOINT_ENV_KEY = "JSKIT_STORAGE_S3_ENDPOINT";
const STORAGE_S3_ACCESS_KEY_ID_ENV_KEY = "JSKIT_STORAGE_S3_ACCESS_KEY_ID";
const STORAGE_S3_SECRET_ACCESS_KEY_ENV_KEY = "JSKIT_STORAGE_S3_SECRET_ACCESS_KEY";
const STORAGE_S3_REQUIRED_ENV_KEYS = Object.freeze([
  STORAGE_S3_BUCKET_ENV_KEY,
  STORAGE_S3_REGION_ENV_KEY,
  STORAGE_S3_ACCESS_KEY_ID_ENV_KEY,
  STORAGE_S3_SECRET_ACCESS_KEY_ENV_KEY
]);
const DEFAULT_STORAGE_DRIVER = "fs";

function normalizeStorageDriver(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || DEFAULT_STORAGE_DRIVER;
}

/**
 * @param {string | undefined} fsBasePath The configured base path, if any.
 * @param {string} appRoot The application's root, under which the default base path lies.
 */
function resolveFsBasePath(fsBasePath, appRoot) {
  const normalized = String(fsBasePath || "").trim();
  if (normalized) {
    return path.resolve(normalized);
  }

  return path.resolve(appRoot, "data", "storage");
}

/**
 * unstorage's own s3 driver over the `JSKIT_STORAGE_S3_*` settings, for an S3 bucket or an S3-compatible store
 * (R2, MinIO) at `JSKIT_STORAGE_S3_ENDPOINT`. A missing required setting refuses, naming each such setting and no
 * value.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
function createS3Driver(env) {
  const setting = (key) => String(env[key] || "").trim();
  const missing = STORAGE_S3_REQUIRED_ENV_KEYS.filter((key) => !setting(key));
  if (missing.length > 0) {
    throw new Error(`${STORAGE_DRIVER_ENV_KEY}=s3 needs ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not set.`);
  }

  const region = setting(STORAGE_S3_REGION_ENV_KEY);
  const driver = s3Driver({
    bucket: setting(STORAGE_S3_BUCKET_ENV_KEY),
    region,
    // unstorage's driver needs an endpoint and addresses objects as endpoint/bucket/key; without one, AWS's own.
    endpoint: setting(STORAGE_S3_ENDPOINT_ENV_KEY) || `https://s3.${region}.amazonaws.com`,
    accessKeyId: setting(STORAGE_S3_ACCESS_KEY_ID_ENV_KEY),
    secretAccessKey: setting(STORAGE_S3_SECRET_ACCESS_KEY_ENV_KEY)
  });

  return {
    ...driver,
    // The driver signs with the options it was made with; the copy it shows names no secret, so logging the mount
    // prints none.
    options: { ...driver.options, secretAccessKey: "[redacted]" }
  };
}

/**
 * The storage `runtime.storage` provides: unstorage over the driver the environment selects.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.env
 * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} options.appRoot
 */
function createStorageBinding({ env, appRoot }) {
  const driver = normalizeStorageDriver(env[STORAGE_DRIVER_ENV_KEY]);

  if (driver === "memory") {
    return createStorage({
      driver: memoryDriver()
    });
  }

  if (driver === "s3") {
    return createStorage({
      driver: createS3Driver(env)
    });
  }

  if (driver !== "fs") {
    throw new Error(`Unsupported ${STORAGE_DRIVER_ENV_KEY} "${driver}". Supported: fs, memory, s3.`);
  }

  const fsBasePath = resolveFsBasePath(env[STORAGE_FS_BASE_PATH_ENV_KEY], appRoot);
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
  STORAGE_S3_ACCESS_KEY_ID_ENV_KEY,
  STORAGE_S3_BUCKET_ENV_KEY,
  STORAGE_S3_ENDPOINT_ENV_KEY,
  STORAGE_S3_REGION_ENV_KEY,
  STORAGE_S3_SECRET_ACCESS_KEY_ENV_KEY,
  DEFAULT_STORAGE_DRIVER,
  normalizeStorageDriver,
  createStorageBinding
};
