import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createCliError } from "./cliError.js";

const CLI_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

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

const BUNDLES_ROOT = path.join(CLI_PACKAGE_ROOT, "bundles");
const CATALOG_PACKAGES_PATH = resolveCatalogPackagesPath();

export {
  CLI_PACKAGE_ROOT,
  BUNDLES_ROOT,
  CATALOG_PACKAGES_PATH
};
