import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");
const KERNEL_PACKAGE_JSON_PATH = path.join(
  REPO_ROOT,
  "packages",
  "kernel",
  "package.json"
);
const SCAN_ROOTS = [
  path.join(REPO_ROOT, "packages"),
  path.join(REPO_ROOT, "tooling", "create-app", "templates")
];
const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage"]);
const EXCLUDED_USAGE_PATH_SEGMENTS = new Set(["test", "tests", "__tests__", "test-support"]);
const TEST_FILENAME_PATTERN = /\.(test|spec)\.[A-Za-z0-9]+$/;
const EXPORTED_UNUSED_ALLOWLIST = new Set(["./_testable"]);

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function shouldScanFile(filePath) {
  return SCANNED_EXTENSIONS.has(path.extname(filePath));
}

function walkFiles(directoryPath) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && shouldScanFile(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
}

function toExportKey(importSubpath) {
  const normalizedSubpath = String(importSubpath || "").replace(/\/+$/g, "");
  if (!normalizedSubpath) {
    return ".";
  }
  return `./${normalizedSubpath}`;
}

function collectScanFiles() {
  const files = [];
  for (const rootPath of SCAN_ROOTS) {
    if (!fs.existsSync(rootPath)) {
      continue;
    }
    files.push(...walkFiles(rootPath));
  }
  return files;
}

function isProductionOrTemplateUsageFile(filePath) {
  const relativePath = normalizeSlash(path.relative(REPO_ROOT, filePath));
  if (relativePath.startsWith("packages/kernel/")) {
    return false;
  }

  const relativeSegments = relativePath.split("/");
  if (relativeSegments.some((segment) => EXCLUDED_USAGE_PATH_SEGMENTS.has(segment))) {
    return false;
  }

  const baseName = path.posix.basename(relativePath);
  if (TEST_FILENAME_PATTERN.test(baseName)) {
    return false;
  }

  return true;
}

function collectKernelImportUsages() {
  const candidateFiles = collectScanFiles().filter((filePath) => isProductionOrTemplateUsageFile(filePath));

  const moduleSpecifierPatterns = [
    /\bimport\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bexport\s+[^"'`]+?\s+from\s+["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
  ];
  const usages = [];

  for (const filePath of candidateFiles) {
    const fileContent = fs.readFileSync(filePath, "utf8");
    const relativePath = normalizeSlash(path.relative(REPO_ROOT, filePath));
    for (const pattern of moduleSpecifierPatterns) {
      let match = null;
      while ((match = pattern.exec(fileContent))) {
        const specifier = String(match[1] || "");
        if (!specifier.startsWith("@jskit-ai/kernel")) {
          continue;
        }
        const importSubpath = specifier.startsWith("@jskit-ai/kernel/")
          ? specifier.slice("@jskit-ai/kernel/".length)
          : "";
        usages.push({
          filePath: relativePath,
          specifier,
          exportKey: toExportKey(importSubpath)
        });
      }
    }
  }

  return usages;
}

function describeMissingExports(usages, exportsMap) {
  const missing = usages
    .filter((usage) => !Object.prototype.hasOwnProperty.call(exportsMap, usage.exportKey))
    .map((usage) => `${usage.exportKey} <- ${usage.filePath} (${usage.specifier})`)
    .sort();

  return missing;
}

test("kernel exports are explicit and aligned with repository usage", () => {
  const packageJson = JSON.parse(fs.readFileSync(KERNEL_PACKAGE_JSON_PATH, "utf8"));
  const exportsMap = packageJson.exports || {};
  const exportKeys = Object.keys(exportsMap).sort();

  const wildcardExports = exportKeys.filter((key) => key.includes("*"));
  assert.deepEqual(
    wildcardExports,
    [],
    `Kernel exports must be explicit. Remove wildcard keys: ${wildcardExports.join(", ")}`
  );

  const usages = collectKernelImportUsages();
  const missingExports = describeMissingExports(usages, exportsMap);
  assert.deepEqual(
    missingExports,
    [],
    `Kernel imports missing from package exports:\n${missingExports.join("\n")}`
  );

  const usedExportKeys = new Set(usages.map((usage) => usage.exportKey));
  const staleExports = exportKeys
    .filter((key) => !usedExportKeys.has(key))
    .filter((key) => !EXPORTED_UNUSED_ALLOWLIST.has(key));

  assert.deepEqual(
    staleExports,
    [],
    `Stale kernel exports found. Remove or allowlist with rationale: ${staleExports.join(", ")}`
  );
});
