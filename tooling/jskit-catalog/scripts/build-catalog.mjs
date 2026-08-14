import path from "node:path";
import process from "node:process";
import { access, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");

function parseInlineArg(name) {
  const args = process.argv.slice(2);
  const exactPrefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const candidate = String(args[index] || "").trim();
    if (!candidate) {
      continue;
    }
    if (candidate === name) {
      const next = String(args[index + 1] || "").trim();
      return next || "";
    }
    if (candidate.startsWith(exactPrefix)) {
      return candidate.slice(exactPrefix.length).trim();
    }
  }
  return "";
}

function toSortedUniqueStrings(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function collectPackageRoots(packagesRoot) {
  const directories = [];
  const levelOne = await readdir(packagesRoot, { withFileTypes: true });

  for (const entry of levelOne) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith(".") || entry.name.endsWith(".LEGACY")) {
      continue;
    }

    const absolute = path.join(packagesRoot, entry.name);
    const packageJsonPath = path.join(absolute, "package.json");
    if (await fileExists(packageJsonPath) && Object.keys((await readJson(packageJsonPath)).jskit || {}).length > 0) {
      directories.push(absolute);
      continue;
    }

    const nested = await readdir(absolute, { withFileTypes: true }).catch(() => []);
    for (const child of nested) {
      if (!child.isDirectory() || child.name.startsWith(".")) {
        continue;
      }
      const nestedAbsolute = path.join(absolute, child.name);
      const nestedPackageJsonPath = path.join(nestedAbsolute, "package.json");
      if (
        await fileExists(nestedPackageJsonPath) &&
        Object.keys((await readJson(nestedPackageJsonPath)).jskit || {}).length > 0
      ) {
        directories.push(nestedAbsolute);
      }
    }
  }

  return toSortedUniqueStrings(directories);
}

async function readJson(absolutePath) {
  const raw = await readFile(absolutePath, "utf8");
  return JSON.parse(raw);
}

async function buildCatalog({ repoRoot, packagesRoot, outputPath }) {
  const packageRoots = await collectPackageRoots(packagesRoot);
  const entries = [];

  for (const packageRoot of packageRoots) {
    const packageJsonPath = path.join(packageRoot, "package.json");
    const packageJson = await readJson(packageJsonPath);
    const packageId = String(packageJson?.name || "").trim();
    const version = String(packageJson?.version || "").trim();
    const jskit = packageJson?.jskit && typeof packageJson.jskit === "object" && !Array.isArray(packageJson.jskit)
      ? packageJson.jskit
      : null;

    if (!packageId) {
      throw new Error(`Missing package name in ${packageJsonPath}`);
    }
    if (!jskit) {
      throw new Error(`Missing jskit metadata in ${packageJsonPath}`);
    }
    if (!version) {
      throw new Error(`Missing version for ${packageId} in ${packageRoot}`);
    }

    entries.push({
      packageId,
      version,
      ...(String(packageJson.description || "").trim()
        ? { description: String(packageJson.description).trim() }
        : {}),
      jskit,
      packageJson: Object.fromEntries(
        ["dependencies", "optionalDependencies", "peerDependencies"]
          .filter((sectionName) => packageJson[sectionName] && typeof packageJson[sectionName] === "object")
          .map((sectionName) => [sectionName, packageJson[sectionName]])
      )
    });
  }

  const catalog = {
    schemaVersion: 1,
    source: {
      kind: "packages-directory"
    },
    packages: entries.sort((left, right) => left.packageId.localeCompare(right.packageId))
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

async function main() {
  const repoRootArg = parseInlineArg("--repo-root");
  const packagesRootArg = parseInlineArg("--packages-root");
  const outputArg = parseInlineArg("--output");

  const repoRoot = path.resolve(repoRootArg || process.env.JSKIT_REPO_ROOT || DEFAULT_REPO_ROOT);
  const packagesRoot = path.resolve(packagesRootArg || path.join(repoRoot, "packages"));
  const outputPath = path.resolve(outputArg || path.join(PACKAGE_ROOT, "catalog", "packages.json"));

  await buildCatalog({ repoRoot, packagesRoot, outputPath });
  process.stdout.write(`Catalog written: ${outputPath}\n`);
}

await main();
