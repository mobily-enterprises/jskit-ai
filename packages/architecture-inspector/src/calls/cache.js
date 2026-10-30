import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_SCHEMA = "jskit.architecture-calls-cache.v1";
const CACHE_FILE = "jskit-calls.json";
// Manifests, lockfiles and compiler configurations change how every file
// resolves, so any change to them rebuilds everything.
const PROJECT_FILE_PATTERN = /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|[jt]sconfig(?:\.[\w.-]+)?\.json)$/u;
const INSPECTOR_VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// The cache file inside the caller's cache directory, or null when the
// directory is not an existing absolute directory outside the project.
async function cacheLocation(projectRoot, directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    return null;
  }
  const resolved = path.resolve(directory);
  if (resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`)) {
    return null;
  }
  const entry = await stat(resolved).catch(() => null);
  return entry?.isDirectory() ? path.join(resolved, CACHE_FILE) : null;
}

async function readCallCache(location, key) {
  try {
    const cache = JSON.parse(await readFile(location, "utf8"));
    return cache?.schema === CACHE_SCHEMA && cache.key === key && cache.files && typeof cache.files === "object" ? cache : null;
  } catch {
    return null;
  }
}

// Written beside the final file and renamed into place; a cache that cannot
// be written only means the next run is cold.
async function writeCallCache(location, cache) {
  const temporary = `${location}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ schema: CACHE_SCHEMA, ...cache }));
    await rename(temporary, location);
  } catch {
    // An unusable cache directory leaves the inspection result unchanged.
  }
}

// Keys for one inspection: everything that affects every file, each file's
// own and directly imported sources, and the whole run.
function cacheKeys({ input, files, imports, scripts, options }) {
  const projectFiles = [...files.values()]
    .filter((file) => PROJECT_FILE_PATTERN.test(file.path))
    .map((file) => [file.path, file.hash])
    .sort();
  const key = digest({
    version: INSPECTOR_VERSION,
    stackHash: input.stackHash ?? null,
    packages: input.packages ?? null,
    uiDiscovery: input.uiDiscovery ?? null,
    options,
    projectFiles
  });
  const importsByFile = new Map();
  for (const use of imports) {
    importsByFile.set(use.fromFile, (importsByFile.get(use.fromFile) || new Set()).add(use.targetFile));
  }
  const fileKeys = new Map(scripts.map((file) => [file, digest([
    files.get(file).hash,
    [...(importsByFile.get(file) || [])].sort().map((target) => [target, files.get(target)?.hash ?? null])
  ])]));
  return { key, fileKeys, runKey: digest([key, [...fileKeys].sort()]) };
}

export { cacheKeys, cacheLocation, readCallCache, writeCallCache };
