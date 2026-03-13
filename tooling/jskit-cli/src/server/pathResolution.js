import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createCliError } from "./cliError.js";

const CLI_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

function isWorkspaceRoot(candidateRoot) {
  if (!candidateRoot) {
    return false;
  }
  return (
    existsSync(path.join(candidateRoot, "packages")) &&
    existsSync(path.join(candidateRoot, "packages", "kernel")) &&
    existsSync(path.join(candidateRoot, "tooling", "jskit-cli"))
  );
}

function collectAncestorDirectories(startDirectory) {
  const ancestors = [];
  let current = path.resolve(startDirectory);
  while (true) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return ancestors;
}

function resolveWorkspaceRoot() {
  const candidates = [];
  const seen = new Set();
  const appendCandidate = (candidatePath) => {
    const raw = String(candidatePath || "").trim();
    if (!raw) {
      return;
    }
    const absolute = path.resolve(raw);
    if (seen.has(absolute)) {
      return;
    }
    seen.add(absolute);
    candidates.push(absolute);
  };

  appendCandidate(process.env.JSKIT_REPO_ROOT);
  appendCandidate(path.resolve(CLI_PACKAGE_ROOT, "../.."));
  appendCandidate(CLI_PACKAGE_ROOT);

  const cwdAncestors = collectAncestorDirectories(process.cwd());
  for (const ancestor of cwdAncestors) {
    appendCandidate(ancestor);
    appendCandidate(path.join(ancestor, "jskit-ai"));
  }

  for (const candidate of candidates) {
    if (isWorkspaceRoot(candidate)) {
      return candidate;
    }
  }

  return "";
}

function resolveCatalogPackagesPath() {
  const explicitPath = String(process.env.JSKIT_CATALOG_PACKAGES_PATH || "").trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  let catalogPackageJsonPath = "";
  try {
    catalogPackageJsonPath = require.resolve("@jskit-ai/jskit-catalog/package.json");
  } catch {}
  if (catalogPackageJsonPath) {
    return path.join(path.dirname(catalogPackageJsonPath), "catalog", "packages.json");
  }

  const workspaceCatalogPath = path.resolve(CLI_PACKAGE_ROOT, "../jskit-catalog/catalog/packages.json");
  if (existsSync(workspaceCatalogPath)) {
    return workspaceCatalogPath;
  }

  throw createCliError(
    "Unable to resolve @jskit-ai/jskit-catalog. Install it alongside @jskit-ai/jskit-cli or set JSKIT_CATALOG_PACKAGES_PATH."
  );
}

const WORKSPACE_ROOT = resolveWorkspaceRoot();
const MODULES_ROOT = WORKSPACE_ROOT ? path.join(WORKSPACE_ROOT, "packages") : "";
const BUNDLES_ROOT = path.join(CLI_PACKAGE_ROOT, "bundles");
const CATALOG_PACKAGES_PATH = resolveCatalogPackagesPath();

export {
  CLI_PACKAGE_ROOT,
  WORKSPACE_ROOT,
  MODULES_ROOT,
  BUNDLES_ROOT,
  CATALOG_PACKAGES_PATH
};
