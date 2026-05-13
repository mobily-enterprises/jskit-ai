import { access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

const REQUIRED_READY_FILES = Object.freeze([
  "package.json",
  ".jskit/lock.json",
  "config/public.js"
]);
const REQUIRED_READY_DIRECTORIES = Object.freeze([
  "src",
  "packages"
]);

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function inspectReadyJskitAppRoot(rootPath) {
  const missing = [];
  for (const relativePath of REQUIRED_READY_FILES) {
    if (!await pathExists(path.join(rootPath, relativePath))) {
      missing.push(relativePath);
    }
  }
  for (const relativePath of REQUIRED_READY_DIRECTORIES) {
    if (!await directoryExists(path.join(rootPath, relativePath))) {
      missing.push(`${relativePath}/`);
    }
  }
  return {
    missing,
    ok: missing.length < 1,
    requiredDirectories: [...REQUIRED_READY_DIRECTORIES],
    requiredFiles: [...REQUIRED_READY_FILES],
    rootPath
  };
}

export {
  inspectReadyJskitAppRoot
};
