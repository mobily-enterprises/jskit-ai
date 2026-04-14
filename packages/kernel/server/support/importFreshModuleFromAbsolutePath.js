import path from "node:path";
import { pathToFileURL } from "node:url";

let freshImportCounter = 0;

function nextFreshImportToken() {
  freshImportCounter += 1;
  return String(freshImportCounter);
}

async function importFreshModuleFromAbsolutePath(absolutePath) {
  const normalizedPath = String(absolutePath || "").trim();
  if (!normalizedPath || !path.isAbsolute(normalizedPath)) {
    throw new Error("importFreshModuleFromAbsolutePath requires an absolute path.");
  }

  const resolvedPath = path.resolve(normalizedPath);
  const moduleUrl = pathToFileURL(resolvedPath);
  moduleUrl.searchParams.set("jskit_fresh", nextFreshImportToken());
  return import(moduleUrl.href);
}

export { importFreshModuleFromAbsolutePath };
