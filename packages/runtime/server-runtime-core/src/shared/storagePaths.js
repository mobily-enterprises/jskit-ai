import path from "node:path";

function resolveFsBasePath(fsBasePath, { rootDir } = {}) {
  const normalized = String(fsBasePath || "").trim();
  if (normalized) {
    return path.resolve(normalized);
  }

  const resolvedRootDir = rootDir || process.cwd();
  return path.resolve(resolvedRootDir, "data", "storage");
}

export { resolveFsBasePath };
