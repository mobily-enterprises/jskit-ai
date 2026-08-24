import path from "node:path";
import process from "node:process";
import { access, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  assertUniquePatternIds,
  discoverPackagePatterns
} from "./pattern-assets.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const BUILTIN_SINGLETON_PACKAGE_IDS = Object.freeze(["@jskit-ai/kernel"]);

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
    if (entry.name.startsWith(".")) {
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

function normalizeWorkspacePatterns(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && Array.isArray(value.packages)) {
    return value.packages;
  }
  return [];
}

function createWorkspaceSegmentPattern(segment = "") {
  const escaped = String(segment || "").replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/gu, "[^/]*").replace(/\?/gu, "[^/]")}$`, "u");
}

async function expandWorkspacePattern(repoRoot, workspacePattern = "") {
  const segments = String(workspacePattern || "")
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 1 || segments.includes("**")) {
    return [];
  }

  let directories = [repoRoot];
  for (const segment of segments) {
    const matcher = createWorkspaceSegmentPattern(segment);
    const nextDirectories = [];
    for (const directory of directories) {
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory() && matcher.test(entry.name)) {
          nextDirectories.push(path.join(directory, entry.name));
        }
      }
    }
    directories = nextDirectories;
  }
  return directories;
}

async function collectReleasePackageVersions(repoRoot) {
  const rootPackageJson = await readJson(path.join(repoRoot, "package.json"));
  const workspacePatterns = normalizeWorkspacePatterns(rootPackageJson.workspaces)
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry && !entry.startsWith("!"));
  const workspaceDirectories = new Set();
  for (const workspacePattern of workspacePatterns) {
    for (const directory of await expandWorkspacePattern(repoRoot, workspacePattern)) {
      workspaceDirectories.add(directory);
    }
  }

  const versions = new Map();
  for (const directory of [...workspaceDirectories].sort()) {
    const packageJsonPath = path.join(directory, "package.json");
    if (!(await fileExists(packageJsonPath))) {
      continue;
    }
    const packageJson = await readJson(packageJsonPath);
    const packageId = String(packageJson?.name || "").trim();
    const version = String(packageJson?.version || "").trim();
    if (!packageId.startsWith("@jskit-ai/") || packageJson.private === true) {
      continue;
    }
    if (!/^\d+\.\d+\.\d+$/u.test(version)) {
      throw new Error(`Published JSKIT workspace ${packageId} requires an exact x.y.z version.`);
    }
    versions.set(packageId, version);
  }

  return Object.fromEntries([...versions].sort(([left], [right]) => left.localeCompare(right)));
}

async function readJson(absolutePath) {
  const raw = await readFile(absolutePath, "utf8");
  return JSON.parse(raw);
}

async function buildCatalog({ repoRoot, packagesRoot, outputPath }) {
  const packageRoots = await collectPackageRoots(packagesRoot);
  const entries = [];
  const patterns = [];

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

    patterns.push(...await discoverPackagePatterns({
      packageRoot,
      packageJson
    }));
  }

  assertUniquePatternIds(patterns);

  const catalog = {
    schemaVersion: 3,
    source: {
      kind: "packages-directory"
    },
    release: {
      packages: await collectReleasePackageVersions(repoRoot),
      singletonPackages: toSortedUniqueStrings([
        ...BUILTIN_SINGLETON_PACKAGE_IDS,
        ...entries
          .filter((entry) => entry?.jskit?.metadata?.client?.singleton === true)
          .map((entry) => entry.packageId)
      ])
    },
    packages: entries.sort((left, right) => left.packageId.localeCompare(right.packageId)),
    patterns: patterns.sort((left, right) => left.id.localeCompare(right.id))
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
