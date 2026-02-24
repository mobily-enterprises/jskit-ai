import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULES_DIR = path.join(ROOT_DIR, "server", "modules");
const SERVER_DIR = path.join(ROOT_DIR, "server");

const ALLOWED_TOP_LEVEL_FILES = new Set([
  "index.js",
  "controller.js",
  "routes.js",
  "schema.js",
  "service.js",
  "repository.js"
]);

const ALLOWED_TOP_LEVEL_DIRECTORIES = new Set([
  "controllers",
  "routes",
  "schemas",
  "services",
  "repositories",
  "lib"
]);

const ROLE_FILE_DIRECTORY_PAIRS = Object.freeze([
  { file: "controller.js", directory: "controllers" },
  { file: "routes.js", directory: "routes" },
  { file: "schema.js", directory: "schemas" },
  { file: "service.js", directory: "services" },
  { file: "repository.js", directory: "repositories" }
]);

const ROLE_DIRECTORY_FILE_PATTERNS = Object.freeze({
  controllers: /^(index\.js|[A-Za-z0-9][A-Za-z0-9_-]*\.controller\.js)$/,
  routes: /^(index\.js|[A-Za-z0-9][A-Za-z0-9_-]*\.routes\.js)$/,
  schemas: /^(index\.js|[A-Za-z0-9][A-Za-z0-9_-]*\.schema\.js)$/,
  services: /^(index\.js|[A-Za-z0-9][A-Za-z0-9_-]*\.service\.js)$/,
  repositories: /^(index\.js|[A-Za-z0-9][A-Za-z0-9_-]*\.repository\.js|shared\.js)$/
});

const MODULE_INTERNAL_PATH_SEGMENTS = Object.freeze(["lib", "controllers", "routes", "schemas", "services", "repositories"]);

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function listJsFilesRecursive(rootDir) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
        files.push(absolutePath);
      }
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir);
  }

  return files;
}

function listModuleDirectories() {
  if (!existsSync(MODULES_DIR)) {
    return [];
  }

  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      absolutePath: path.join(MODULES_DIR, entry.name)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseImportSpecifiers(filePath) {
  const source = readFileSync(filePath, "utf8");
  const specifiers = [];

  const importExportPattern = /(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(importExportPattern)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(dynamicImportPattern)) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

function resolveRelativeImport(fromFilePath, importSpecifier) {
  if (!String(importSpecifier || "").startsWith(".")) {
    return null;
  }

  const resolvedBasePath = path.resolve(path.dirname(fromFilePath), importSpecifier);
  const candidatePaths = [
    resolvedBasePath,
    `${resolvedBasePath}.js`,
    `${resolvedBasePath}.mjs`,
    `${resolvedBasePath}.cjs`,
    path.join(resolvedBasePath, "index.js")
  ];

  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
      return candidatePath;
    }
  }

  return null;
}

function classifyModuleFile(filePath) {
  const relativePath = toPosixPath(path.relative(ROOT_DIR, filePath));
  const match = relativePath.match(/^server\/modules\/([^/]+)\/(.+)$/);
  if (!match) {
    return null;
  }

  return {
    moduleName: match[1],
    moduleRelativePath: match[2],
    relativePath
  };
}

test("architecture guardrail: every module has index.js", () => {
  const missing = [];

  for (const moduleDir of listModuleDirectories()) {
    const indexFilePath = path.join(moduleDir.absolutePath, "index.js");
    if (!existsSync(indexFilePath)) {
      missing.push(toPosixPath(path.relative(ROOT_DIR, moduleDir.absolutePath)));
    }
  }

  assert.deepEqual(missing, []);
});

test("architecture guardrail: module top-level entries follow file and directory allowlists", () => {
  const violations = [];

  for (const moduleDir of listModuleDirectories()) {
    const entries = readdirSync(moduleDir.absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        if (!ALLOWED_TOP_LEVEL_FILES.has(entry.name)) {
          violations.push(`${moduleDir.name}:file:${entry.name}`);
        }
        continue;
      }

      if (entry.isDirectory() && !ALLOWED_TOP_LEVEL_DIRECTORIES.has(entry.name)) {
        violations.push(`${moduleDir.name}:directory:${entry.name}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("architecture guardrail: module roles use file-or-directory exclusivity", () => {
  const violations = [];

  for (const moduleDir of listModuleDirectories()) {
    for (const role of ROLE_FILE_DIRECTORY_PAIRS) {
      const filePath = path.join(moduleDir.absolutePath, role.file);
      const directoryPath = path.join(moduleDir.absolutePath, role.directory);

      if (existsSync(filePath) && existsSync(directoryPath)) {
        violations.push(`${moduleDir.name}:${role.file}+${role.directory}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("architecture guardrail: role directories use canonical filenames only", () => {
  const violations = [];

  for (const moduleDir of listModuleDirectories()) {
    for (const [directoryName, filenamePattern] of Object.entries(ROLE_DIRECTORY_FILE_PATTERNS)) {
      const roleDirectoryPath = path.join(moduleDir.absolutePath, directoryName);
      if (!existsSync(roleDirectoryPath)) {
        continue;
      }

      const entries = readdirSync(roleDirectoryPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          violations.push(`${moduleDir.name}:${directoryName}:non-file:${entry.name}`);
          continue;
        }

        if (!filenamePattern.test(entry.name)) {
          violations.push(`${moduleDir.name}:${directoryName}:${entry.name}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("architecture guardrail: production code imports cross-module seams via module index only", () => {
  const violations = [];
  const sourceFiles = listJsFilesRecursive(SERVER_DIR);

  for (const sourceFilePath of sourceFiles) {
    const sourceClassification = classifyModuleFile(sourceFilePath);
    const importSpecifiers = parseImportSpecifiers(sourceFilePath);

    for (const importSpecifier of importSpecifiers) {
      const resolvedImportPath = resolveRelativeImport(sourceFilePath, importSpecifier);
      if (!resolvedImportPath) {
        continue;
      }

      const targetClassification = classifyModuleFile(resolvedImportPath);
      if (!targetClassification) {
        continue;
      }

      const isSameModule =
        sourceClassification && sourceClassification.moduleName === targetClassification.moduleName;

      if (isSameModule) {
        continue;
      }

      if (targetClassification.moduleRelativePath !== "index.js") {
        violations.push(
          `${toPosixPath(path.relative(ROOT_DIR, sourceFilePath))} -> ${targetClassification.relativePath}`
        );
        continue;
      }

      const startsWithInternalSegment = MODULE_INTERNAL_PATH_SEGMENTS.some((segment) =>
        targetClassification.moduleRelativePath.startsWith(`${segment}/`)
      );

      if (startsWithInternalSegment) {
        violations.push(
          `${toPosixPath(path.relative(ROOT_DIR, sourceFilePath))} -> ${targetClassification.relativePath}`
        );
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("architecture guardrail: module index files forbid wildcard exports", () => {
  const violations = [];

  for (const moduleDir of listModuleDirectories()) {
    const indexFilePath = path.join(moduleDir.absolutePath, "index.js");
    const source = readFileSync(indexFilePath, "utf8");

    if (/^\s*export\s+\*\s+/m.test(source)) {
      violations.push(`${moduleDir.name}:wildcard-export`);
    }

    if (/^\s*export\s+default\s+/m.test(source)) {
      violations.push(`${moduleDir.name}:default-export`);
    }
  }

  assert.deepEqual(violations, []);
});
