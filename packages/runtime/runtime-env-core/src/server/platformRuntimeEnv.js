import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { cleanEnv } from "envalid";
import { createPlatformRuntimeEnvSpec } from "../lib/platformRuntimeEnvSpecs.js";

function normalizeDotenvFileList(dotenvFiles) {
  if (!Array.isArray(dotenvFiles) || dotenvFiles.length < 1) {
    return [".env"];
  }

  return dotenvFiles
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function resolveDotenvPaths({ rootDir = process.cwd(), dotenvFiles } = {}) {
  const normalizedRootDir = path.resolve(rootDir || process.cwd());
  const fileList = normalizeDotenvFileList(dotenvFiles);
  return fileList.map((fileName) => path.resolve(normalizedRootDir, fileName));
}

function loadDotenvFiles({ rootDir = process.cwd(), dotenvFiles, override = false } = {}) {
  const dotenvPaths = resolveDotenvPaths({ rootDir, dotenvFiles });
  for (const dotenvPath of dotenvPaths) {
    if (!fs.existsSync(dotenvPath)) {
      continue;
    }

    dotenv.config({ path: dotenvPath, override: Boolean(override) });
  }

  return dotenvPaths;
}

function createThrowingReporter() {
  return ({ errors = {} } = {}) => {
    const entries = Object.entries(errors).filter(([, value]) => Boolean(value));
    if (entries.length < 1) {
      return;
    }

    const message = entries.map(([name, value]) => `${name}: ${String(value?.message || value)}`).join("; ");
    throw new Error(`Invalid runtime environment: ${message}`);
  };
}

function createPlatformRuntimeEnv({
  env = process.env,
  defaults = {},
  rootDir = process.cwd(),
  dotenvFiles = [".env"],
  loadDotenv = true,
  strict = true,
  reporter = createThrowingReporter()
} = {}) {
  if (loadDotenv) {
    loadDotenvFiles({
      rootDir,
      dotenvFiles,
      override: false
    });
  }

  const spec = createPlatformRuntimeEnvSpec({ defaults });
  return cleanEnv(env, spec, { strict: Boolean(strict), reporter });
}

const __testables = {
  normalizeDotenvFileList,
  resolveDotenvPaths,
  createThrowingReporter
};

export { createPlatformRuntimeEnv, loadDotenvFiles, resolveDotenvPaths, __testables };
