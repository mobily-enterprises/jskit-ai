import { createRequire } from "node:module";
import path from "node:path";

function createRequireFromTarget(targetPath) {
  const normalized = String(targetPath || "").trim();
  if (!normalized) {
    return null;
  }

  try {
    return createRequire(normalized);
  } catch {
    return null;
  }
}

function createAppRootRequire() {
  const cwd = String(process.cwd() || "").trim();
  if (!cwd) {
    return null;
  }

  return createRequireFromTarget(path.join(cwd, "package.json"));
}

function createEntryScriptRequire() {
  const entryScriptPath = String(process.argv?.[1] || "").trim();
  if (!entryScriptPath) {
    return null;
  }

  return createRequireFromTarget(path.resolve(entryScriptPath));
}

const localRequire = createRequire(import.meta.url);

function uniqueRequireChain(candidates = []) {
  const chain = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "function") {
      continue;
    }
    if (chain.includes(candidate)) {
      continue;
    }
    chain.push(candidate);
  }
  return chain;
}

function symlinkSafeRequire(moduleId = "") {
  const normalizedModuleId = String(moduleId || "").trim();
  if (!normalizedModuleId) {
    throw new TypeError("symlinkSafeRequire requires a non-empty module id.");
  }

  const requireChain = uniqueRequireChain([createAppRootRequire(), createEntryScriptRequire(), localRequire]);
  let lastModuleNotFoundError = null;

  for (const candidateRequire of requireChain) {
    try {
      return candidateRequire(normalizedModuleId);
    } catch (error) {
      if (String(error?.code || "").trim() === "MODULE_NOT_FOUND") {
        lastModuleNotFoundError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastModuleNotFoundError) {
    throw lastModuleNotFoundError;
  }
  throw new Error(`Failed to resolve module "${normalizedModuleId}".`);
}

export { symlinkSafeRequire };
