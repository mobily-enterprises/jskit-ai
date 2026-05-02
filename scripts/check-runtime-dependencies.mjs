import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const PACKAGES_DIR = path.join(ROOT_DIR, "packages");
const SOURCE_ROOT_NAMES = Object.freeze(["src", "client", "server", "shared"]);
const SOURCE_FILE_PATTERN = /\.(?:[cm]?js|vue)$/;
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?js|vue)$/;
const BUILTIN_DEPENDENCIES = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "node:assert",
  "node:buffer",
  "node:child_process",
  "node:crypto",
  "node:events",
  "node:fs",
  "node:http",
  "node:https",
  "node:module",
  "node:os",
  "node:path",
  "node:process",
  "node:stream",
  "node:test",
  "node:url",
  "node:util",
  "node:vm",
  "os",
  "path",
  "process",
  "stream",
  "test",
  "url",
  "util",
  "vm"
]);

const STATIC_IMPORT_PATTERN = /^\s*import\s+[\s\S]*?\s+from\s+["']([^"']+)["']/gm;
const EXPORT_FROM_PATTERN = /^\s*export\s+[\s\S]*?\s+from\s+["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_PATTERN = /^\s*import\s*\(\s*["']([^"']+)["']\s*\)/gm;

async function listWorkspacePackageDirs() {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name))
    .sort();
}

async function fileExists(targetPath) {
  try {
    await readFile(targetPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function walkSourceFiles(directoryPath, files = []) {
  let entries = [];
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }
      await walkSourceFiles(fullPath, files);
      continue;
    }

    if (!SOURCE_FILE_PATTERN.test(entry.name) || TEST_FILE_PATTERN.test(entry.name)) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function extractPackageSpecifier(specifier = "") {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) {
    return null;
  }

  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    if (!scope || !name) {
      return null;
    }
    return `${scope}/${name}`;
  }

  const [name] = specifier.split("/");
  return name || null;
}

function maskNonCode(source = "") {
  const characters = Array.from(String(source || ""));
  let index = 0;
  while (index < characters.length) {
    const current = characters[index];
    const next = characters[index + 1];

    if (current === "/" && next === "/") {
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 2;
      while (index < characters.length && characters[index] !== "\n") {
        characters[index] = " ";
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 2;
      while (index < characters.length) {
        const blockCurrent = characters[index];
        const blockNext = characters[index + 1];
        if (blockCurrent === "*" && blockNext === "/") {
          characters[index] = " ";
          characters[index + 1] = " ";
          index += 2;
          break;
        }
        if (blockCurrent !== "\n") {
          characters[index] = " ";
        }
        index += 1;
      }
      continue;
    }

    if (current === "'" || current === "\"" || current === "`") {
      const quote = current;
      characters[index] = " ";
      index += 1;
      while (index < characters.length) {
        const value = characters[index];
        if (value === "\\") {
          characters[index] = " ";
          if (index + 1 < characters.length && characters[index + 1] !== "\n") {
            characters[index + 1] = " ";
          }
          index += 2;
          continue;
        }
        if (value === quote) {
          characters[index] = " ";
          index += 1;
          break;
        }
        if (value !== "\n") {
          characters[index] = " ";
        }
        index += 1;
      }
      continue;
    }

    index += 1;
  }

  return characters.join("");
}

function collectImportedPackages(source = "") {
  const normalizedSource = maskNonCode(source);
  const importedPackages = [];
  for (const pattern of [STATIC_IMPORT_PATTERN, EXPORT_FROM_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of normalizedSource.matchAll(pattern)) {
      const specifier = match[1];
      const packageName = extractPackageSpecifier(specifier);
      if (!packageName || BUILTIN_DEPENDENCIES.has(packageName)) {
        continue;
      }
      importedPackages.push(packageName);
    }
  }
  return importedPackages;
}

function toRelativePackagePath(packageDir, filePath) {
  return path.relative(packageDir, filePath).split(path.sep).join("/");
}

async function collectDependencyProblems(packageDir) {
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    return [];
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const declaredDependencies = new Set([
    packageJson.name,
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
    ...Object.keys(packageJson.optionalDependencies || {})
  ]);

  const sourceFiles = [];
  for (const rootName of SOURCE_ROOT_NAMES) {
    await walkSourceFiles(path.join(packageDir, rootName), sourceFiles);
  }

  const missingByPackage = new Map();
  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    const importedPackages = collectImportedPackages(source);
    for (const importedPackage of importedPackages) {
      if (declaredDependencies.has(importedPackage)) {
        continue;
      }

      const files = missingByPackage.get(importedPackage) || [];
      files.push(toRelativePackagePath(packageDir, sourceFile));
      missingByPackage.set(importedPackage, files);
    }
  }

  return Array.from(missingByPackage.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([packageName, files]) => ({
      packageName,
      files: Array.from(new Set(files)).sort()
    }));
}

async function main() {
  const packageDirs = await listWorkspacePackageDirs();
  const problems = [];

  for (const packageDir of packageDirs) {
    const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
    const missingDependencies = await collectDependencyProblems(packageDir);
    if (missingDependencies.length === 0) {
      continue;
    }

    problems.push({
      packageName: packageJson.name,
      missingDependencies
    });
  }

  if (problems.length === 0) {
    process.stdout.write("Runtime dependency audit passed.\n");
    return;
  }

  for (const problem of problems) {
    process.stderr.write(`${problem.packageName} is missing declared imports:\n`);
    for (const missingDependency of problem.missingDependencies) {
      process.stderr.write(`  - ${missingDependency.packageName}\n`);
      for (const filePath of missingDependency.files) {
        process.stderr.write(`      ${filePath}\n`);
      }
    }
  }

  process.exitCode = 1;
}

await main();
