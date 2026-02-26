#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_ROOT = path.join(REPO_ROOT, "apps", "jskit-value-app");
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".vue", ".json", ".md", ".yml", ".yaml"]);

const RUNTIME_ROOT_PREFIXES = Object.freeze([
  "bin/",
  "config/",
  "db/",
  "migrations/",
  "seeds/",
  "ops/",
  "shared/",
  "server/",
  "src/"
]);

const ALLOWED_PATTERNS = Object.freeze([
  /^server\.js$/,
  /^bin\/server\.js$/,
  /^config\//,
  /^db\/knex\.js$/,
  /^migrations\//,
  /^seeds\//,
  /^ops\//,
  /^shared\/rbac\.manifest\.json$/,
  /^shared\/settings\.md$/,
  /^server\/app\//,
  /^server\/modules\/projects\//,
  /^server\/modules\/deg2rad\//,
  /^src\/app\//,
  /^src\/modules\/projects\//,
  /^src\/modules\/deg2rad\//,
  /^src\/views\/projects\//,
  /^src\/views\/deg2rad-calculator\//
]);

function parseArgs(argv) {
  return {
    strict: new Set(argv).has("--strict")
  };
}

function toPosix(value) {
  return value.replaceAll(path.sep, "/");
}

function shouldSkipDirectory(name) {
  return (
    name === "node_modules" ||
    name === "dist" ||
    name === "build" ||
    name === ".artifacts" ||
    name === "coverage" ||
    name === "test-results" ||
    name.startsWith(".")
  );
}

function walkFiles(rootPath, output = []) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
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
    output.push(absolutePath);
  }
  return output;
}

function isRuntimePath(relativePath) {
  return RUNTIME_ROOT_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function isAllowed(relativePath) {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = walkFiles(APP_ROOT);
  const runtimeFiles = files
    .map((filePath) => toPosix(path.relative(APP_ROOT, filePath)))
    .filter((relativePath) => isRuntimePath(relativePath));

  const violations = runtimeFiles.filter((relativePath) => !isAllowed(relativePath));

  process.stdout.write(`app-ownership: scanned ${runtimeFiles.length} runtime files\n`);
  process.stdout.write(`app-ownership: violations ${violations.length}\n`);
  for (const violation of violations) {
    process.stdout.write(`- ${violation}\n`);
  }

  if (options.strict && violations.length > 0) {
    process.exitCode = 1;
  }
}

main();
