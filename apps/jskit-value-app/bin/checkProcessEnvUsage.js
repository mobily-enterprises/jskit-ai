#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const PROCESS_ENV_PATTERN = /\bprocess\.env\b/;
const JS_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);
const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "tests",
  "dist",
  "dist-internal",
  "dist-public",
  "coverage",
  ".vite"
]);

// Keep this list short and explicit. These files are infrastructure/runtime config entry points.
const ALLOWED_FILES = new Set([
  "bin/checkProcessEnvUsage.js",
  "knexfile.cjs",
  "vite.config.mjs",
  "playwright.config.mjs"
]);

async function listJsFilesRecursively(startDir, relativePrefix = "") {
  const entries = await fs.readdir(startDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryName = entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entryName)) {
        continue;
      }
      const nextRelativePrefix = relativePrefix ? `${relativePrefix}/${entryName}` : entryName;
      files.push(...(await listJsFilesRecursively(path.join(startDir, entryName), nextRelativePrefix)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entryName).toLowerCase();
    if (!JS_EXTENSIONS.has(extension)) {
      continue;
    }

    const relativePath = relativePrefix ? `${relativePrefix}/${entryName}` : entryName;
    files.push(relativePath);
  }

  return files;
}

async function findProcessEnvUsages(files) {
  const violations = [];

  for (const relativePath of files) {
    if (ALLOWED_FILES.has(relativePath)) {
      continue;
    }

    const absolutePath = path.resolve(ROOT_DIR, relativePath);
    const sourceText = await fs.readFile(absolutePath, "utf8");
    if (!PROCESS_ENV_PATTERN.test(sourceText)) {
      continue;
    }

    const lines = sourceText.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!PROCESS_ENV_PATTERN.test(lines[index])) {
        continue;
      }
      violations.push({
        file: relativePath,
        line: index + 1,
        text: lines[index].trim()
      });
    }
  }

  return violations;
}

function printViolationReport(violations) {
  process.stderr.write("Disallowed process.env usage detected outside approved files.\n");
  process.stderr.write("Allowed files:\n");
  for (const file of Array.from(ALLOWED_FILES).sort()) {
    process.stderr.write(`- ${file}\n`);
  }
  process.stderr.write("\nViolations:\n");
  for (const violation of violations) {
    process.stderr.write(`- ${violation.file}:${violation.line}: ${violation.text}\n`);
  }
}

async function main() {
  const files = await listJsFilesRecursively(ROOT_DIR);
  const violations = await findProcessEnvUsages(files);
  if (violations.length > 0) {
    printViolationReport(violations);
    process.exitCode = 1;
    return;
  }

  process.stdout.write("OK: no disallowed process.env usage found.\n");
}

try {
  await main();
} catch (error) {
  process.stderr.write(`process.env guard failed: ${error?.message || error}\n`);
  process.exitCode = 1;
}
