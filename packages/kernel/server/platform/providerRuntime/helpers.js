import { access, constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import { escapeRegExp } from "../../../shared/surface/escapeRegExp.js";

function isIdentifier(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(value || ""));
}

function createWildcardMatcher(pattern) {
  const rawPattern = String(pattern || "").trim();
  if (!rawPattern) {
    return null;
  }

  const escapedPattern = escapeRegExp(rawPattern).replace(/\\\*/g, ".*");
  return new RegExp(`^${escapedPattern}$`);
}

function normalizeRelativePath(fromPath, targetPath) {
  const relative = path.relative(path.resolve(fromPath), path.resolve(targetPath));
  return relative.split(path.sep).join("/");
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isInsidePackageRoot(packageRoot, candidatePath) {
  const relative = path.relative(path.resolve(packageRoot), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toAbsoluteSortedUniquePaths(values) {
  const source = Array.isArray(values) ? values : [];
  return Object.freeze(
    [...new Set(source.map((entry) => path.resolve(entry)).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right)
    )
  );
}

export {
  isIdentifier,
  createWildcardMatcher,
  normalizeRelativePath,
  fileExists,
  isInsidePackageRoot,
  toAbsoluteSortedUniquePaths
};
