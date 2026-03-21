import fs from "node:fs";
import path from "node:path";

const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage"]);
const EXCLUDED_USAGE_PATH_SEGMENTS = new Set(["test", "tests", "__tests__", "test-support"]);
const TEST_FILENAME_PATTERN = /\.(test|spec)\.[A-Za-z0-9]+$/;
const MODULE_SPECIFIER_PATTERNS = [
  /\bimport\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
  /\bexport\s+[^"'`]+?\s+from\s+["'`]([^"'`]+)["'`]/g,
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
];

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

function collectScanFiles(scanRoots = []) {
  const files = [];
  for (const rootPath of scanRoots) {
    if (!fs.existsSync(rootPath)) {
      continue;
    }
    files.push(...walkFiles(rootPath));
  }
  return files;
}

function isUsageFile(filePath, { repoRoot, packageRelativeRoot }) {
  const relativePath = normalizeSlash(path.relative(repoRoot, filePath));
  if (
    relativePath.startsWith(`${packageRelativeRoot}/src/`) ||
    relativePath.startsWith(`${packageRelativeRoot}/test/`) ||
    relativePath.startsWith(`${packageRelativeRoot}/test-support/`)
  ) {
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

function collectPackageImportUsages({
  repoRoot,
  packageId,
  packageRelativeRoot,
  scanRoots
}) {
  const candidateFiles = collectScanFiles(scanRoots).filter((filePath) =>
    isUsageFile(filePath, { repoRoot, packageRelativeRoot })
  );
  const usages = [];

  for (const filePath of candidateFiles) {
    const fileContent = fs.readFileSync(filePath, "utf8");
    const relativePath = normalizeSlash(path.relative(repoRoot, filePath));
    for (const pattern of MODULE_SPECIFIER_PATTERNS) {
      let match = null;
      while ((match = pattern.exec(fileContent))) {
        const specifier = String(match[1] || "");
        if (!specifier.startsWith(packageId)) {
          continue;
        }

        const importSubpath = specifier.startsWith(`${packageId}/`)
          ? specifier.slice(`${packageId}/`.length)
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

function evaluatePackageExportsContract({
  repoRoot,
  packageDir,
  packageId,
  requiredExports = [],
  scanRoots = [
    path.join(repoRoot, "packages"),
    path.join(repoRoot, "tooling", "create-app", "templates")
  ]
}) {
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const exportsMap = packageJson.exports || {};
  const exportKeys = Object.keys(exportsMap).sort();

  const wildcardExports = exportKeys.filter((key) => key.includes("*"));

  const packageRelativeRoot = normalizeSlash(path.relative(repoRoot, packageDir));
  const usages = collectPackageImportUsages({
    repoRoot,
    packageId,
    packageRelativeRoot,
    scanRoots
  });

  const missingExports = usages
    .filter((usage) => !Object.prototype.hasOwnProperty.call(exportsMap, usage.exportKey))
    .map((usage) => `${usage.exportKey} <- ${usage.filePath} (${usage.specifier})`)
    .sort();

  const usedExportKeys = new Set(usages.map((usage) => usage.exportKey));
  const requiredExportSet = new Set(requiredExports.map((value) => String(value || "").trim()).filter(Boolean));
  const missingRequiredExports = [...requiredExportSet]
    .filter((exportKey) => !Object.prototype.hasOwnProperty.call(exportsMap, exportKey))
    .sort();
  const staleExports = exportKeys
    .filter((exportKey) => !usedExportKeys.has(exportKey))
    .filter((exportKey) => !requiredExportSet.has(exportKey))
    .sort();

  return Object.freeze({
    wildcardExports,
    missingExports,
    missingRequiredExports,
    staleExports
  });
}

export { evaluatePackageExportsContract };
