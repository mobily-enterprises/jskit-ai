import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const KERNEL_ROOT = path.resolve(TEST_DIRECTORY, "..");
const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage"]);
const NON_DETERMINISTIC_IMPORT_PATTERN = /(Date\.now\s*\(|Math\.random\s*\()/;

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

function resolveLineNumberFromIndex(source, index) {
  if (index <= 0) {
    return 1;
  }
  return source.slice(0, index).split(/\r?\n/).length;
}

function resolveImportStatementSlice(source, importStartIndex) {
  const semicolonIndex = source.indexOf(";", importStartIndex);
  if (semicolonIndex === -1) {
    return source.slice(importStartIndex, importStartIndex + 400);
  }
  return source.slice(importStartIndex, semicolonIndex + 1);
}

function collectNonDeterministicDynamicImportViolations() {
  const kernelFiles = walkFiles(KERNEL_ROOT);
  const violations = [];

  for (const filePath of kernelFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const relativePath = normalizeSlash(path.relative(KERNEL_ROOT, filePath));
    const dynamicImportPattern = /\bimport\s*\(/g;
    let match = null;

    while ((match = dynamicImportPattern.exec(source))) {
      const importStartIndex = match.index;
      const importStatement = resolveImportStatementSlice(source, importStartIndex);
      if (!NON_DETERMINISTIC_IMPORT_PATTERN.test(importStatement)) {
        continue;
      }
      violations.push(`${relativePath}:${resolveLineNumberFromIndex(source, importStartIndex)}`);
    }
  }

  return violations.sort();
}

test("kernel dynamic imports do not use Date.now or Math.random cache busting", () => {
  const violations = collectNonDeterministicDynamicImportViolations();
  assert.deepEqual(
    violations,
    [],
    `Kernel dynamic imports must be deterministic. Remove Date.now/Math.random from: ${violations.join(", ")}`
  );
});
