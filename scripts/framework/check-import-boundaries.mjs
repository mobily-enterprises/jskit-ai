#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, toPosix } from "./_utils.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_ROOTS = Object.freeze([
  path.join(REPO_ROOT, "packages"),
  path.join(REPO_ROOT, "apps"),
  path.join(REPO_ROOT, "scripts"),
  path.join(REPO_ROOT, "tests")
]);
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".vue"]);
const IMPORT_EXPORT_RE = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g;

const LIB_BANNED_PACKAGE_PREFIXES = Object.freeze([
  "node:",
  "knex",
  "mysql2"
]);

function walkFiles(rootPath, output = []) {
  if (!fs.existsSync(rootPath)) {
    return output;
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      walkFiles(absolutePath, output);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!JS_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    if (entry.name.includes(".test.") || entry.name.includes(".spec.")) {
      continue;
    }
    output.push(absolutePath);
  }

  return output;
}

function getRuntimeType(filePath) {
  const normalized = toPosix(path.relative(REPO_ROOT, filePath));
  if (normalized.includes("/src/lib/")) {
    return "lib";
  }
  if (normalized.includes("/src/client/")) {
    return "client";
  }
  if (normalized.includes("/src/server/")) {
    return "server";
  }
  return "";
}

function listImports(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const imports = new Set();
  for (const match of source.matchAll(IMPORT_EXPORT_RE)) {
    imports.add(String(match[1] || "").trim());
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) {
    imports.add(String(match[1] || "").trim());
  }
  for (const match of source.matchAll(REQUIRE_RE)) {
    imports.add(String(match[1] || "").trim());
  }
  return [...imports];
}

function isRelativeInto(importPath, runtimeSegment) {
  if (!importPath.startsWith(".")) {
    return false;
  }
  return importPath.includes(`/${runtimeSegment}/`) || importPath.includes(`\\${runtimeSegment}\\`);
}

function checkFile(filePath) {
  const violations = [];
  const runtimeType = getRuntimeType(filePath);
  const imports = listImports(filePath);
  const relativePath = toPosix(path.relative(REPO_ROOT, filePath));

  for (const importPath of imports) {
    if (/^@jskit-ai\/[^/]+$/.test(importPath)) {
      violations.push({
        file: relativePath,
        rule: "jskit-bare-package-import",
        importPath
      });
    }

    if (runtimeType === "lib") {
      if (LIB_BANNED_PACKAGE_PREFIXES.some((prefix) => importPath.startsWith(prefix))) {
        violations.push({
          file: relativePath,
          rule: "lib-banned-runtime-import",
          importPath
        });
      }
      if (isRelativeInto(importPath, "server") || isRelativeInto(importPath, "client")) {
        violations.push({
          file: relativePath,
          rule: "lib-cross-runtime-relative-import",
          importPath
        });
      }
      continue;
    }

    if (runtimeType === "client" && isRelativeInto(importPath, "server")) {
      violations.push({
        file: relativePath,
        rule: "client-imports-server",
        importPath
      });
      continue;
    }

    if (runtimeType === "server" && isRelativeInto(importPath, "client")) {
      violations.push({
        file: relativePath,
        rule: "server-imports-client",
        importPath
      });
    }
  }

  return violations;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = SOURCE_ROOTS.flatMap((sourceRoot) => walkFiles(sourceRoot));
  const violations = files.flatMap((filePath) => checkFile(filePath));

  process.stdout.write(`runtime-boundaries: scanned ${files.length} files\n`);
  process.stdout.write(`runtime-boundaries: violations ${violations.length}\n`);
  for (const violation of violations) {
    process.stdout.write(`- [${violation.rule}] ${violation.file} -> ${violation.importPath}\n`);
  }

  if (options.strict && violations.length > 0) {
    process.exitCode = 1;
  }
}

main();
