import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");
const SOURCE_SCOPE_MARKERS = ["/src/server/", "/templates/src/local-package/server/"];
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const DISALLOWED_PATTERNS = [
  {
    description: "spread pass-through from request.input",
    regex: /\.{3}\s*request\.input\.(body|query|params)\b/g
  },
  {
    description: "whole-section pass-through from request.input",
    regex: /\binput\s*:\s*request\.input\.(body|query|params)\b/g
  }
];

async function listFilesRecursive(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(absolutePath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function isRouteServerSourceFile(absolutePath) {
  const normalizedPath = absolutePath.split(path.sep).join("/");
  if (!SOURCE_SCOPE_MARKERS.some((marker) => normalizedPath.includes(marker))) {
    return false;
  }
  return JS_EXTENSIONS.has(path.extname(absolutePath));
}

function findLineNumber(sourceText, index) {
  return sourceText.slice(0, index).split("\n").length;
}

test("server route handlers do not pass through request.input sections", async () => {
  const allFiles = await listFilesRecursive(PACKAGES_ROOT);
  const targetFiles = allFiles.filter((absolutePath) => isRouteServerSourceFile(absolutePath));
  const violations = [];

  for (const absolutePath of targetFiles) {
    const sourceText = await readFile(absolutePath, "utf8");
    for (const { regex, description } of DISALLOWED_PATTERNS) {
      regex.lastIndex = 0;
      let match = regex.exec(sourceText);
      while (match) {
        const line = findLineNumber(sourceText, match.index);
        violations.push(
          `${path.relative(REPO_ROOT, absolutePath)}:${line} ${description}: ${match[0]}`
        );
        match = regex.exec(sourceText);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found request.input pass-through patterns:\n${violations.join("\n")}`
  );
});
