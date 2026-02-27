import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FORBIDDEN_IMPORT = "@jskit-ai/web-runtime-core/apiClients";
const IGNORE_DIRS = new Set([".git", "node_modules", "coverage", "dist", "build"]);
const ALLOWED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".vue", ".md", ".json"]);
const MIGRATION_DOC_PATTERN = /(^|\/)THE_GREAT_TIDYING_UP(?:_BASELINE)?\.md$/i;

function toRepoRoot() {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "../../../../..");
}

function walkFiles(rootDir, startDir, output) {
  const absoluteDir = path.join(rootDir, startDir);
  if (!fs.existsSync(absoluteDir)) {
    return;
  }

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    const relativePath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(rootDir, relativePath, output);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    output.push(relativePath);
  }
}

function collectScanTargets(repoRoot) {
  const targets = [];

  for (const rootEntry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (!rootEntry.isFile()) {
      continue;
    }
    if (!ALLOWED_EXTENSIONS.has(path.extname(rootEntry.name))) {
      continue;
    }
    targets.push(rootEntry.name);
  }

  for (const scopedDir of ["apps", "packages", "tests", "docs"]) {
    walkFiles(repoRoot, scopedDir, targets);
  }

  return targets;
}

function isMigrationDoc(relativePath) {
  return MIGRATION_DOC_PATTERN.test(relativePath.replaceAll(path.sep, "/"));
}

test("web-runtime-core no longer exposes apiClients directory", () => {
  const apiClientsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "apiClients");
  assert.equal(fs.existsSync(apiClientsDir), false, `${apiClientsDir} must not exist`);
});

test("web-runtime-core apiClients import path is not used outside migration docs", () => {
  const repoRoot = toRepoRoot();
  const selfRelativePath = path.relative(repoRoot, fileURLToPath(import.meta.url));
  const offenders = [];

  for (const relativePath of collectScanTargets(repoRoot)) {
    if (relativePath === selfRelativePath) {
      continue;
    }
    if (isMigrationDoc(relativePath)) {
      continue;
    }

    const absolutePath = path.join(repoRoot, relativePath);
    const fileContents = fs.readFileSync(absolutePath, "utf8");
    if (fileContents.includes(FORBIDDEN_IMPORT)) {
      offenders.push(relativePath);
    }
  }

  assert.deepEqual(offenders, []);
});
