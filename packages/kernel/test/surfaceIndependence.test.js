import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");
const KERNEL_ROOT = path.join(REPO_ROOT, "packages", "kernel");
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage"]);
const DISALLOWED_SURFACE_LITERALS = new Set(["app", "admin", "console", "home"]);
const ALLOWED_PUBLIC_LITERAL_FILES = new Set([
  "packages/kernel/shared/support/policies.js"
]);

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
    if (!entry.isFile()) {
      continue;
    }
    if (!absolutePath.endsWith(".js") || absolutePath.endsWith(".test.js")) {
      continue;
    }
    files.push(absolutePath);
  }

  return files;
}

function toRelativePath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
}

function collectExactStringLiteralHits(source, values) {
  const hits = [];
  const pattern = /(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1/g;
  let match = null;

  while ((match = pattern.exec(source))) {
    const literal = String(match[2] || "");
    if (!values.has(literal)) {
      continue;
    }
    hits.push({
      literal,
      index: match.index
    });
  }

  return hits;
}

test("kernel non-test code stays surface-id agnostic", () => {
  const files = walkFiles(KERNEL_ROOT);
  const forbiddenHits = [];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    const relativePath = toRelativePath(filePath);
    const literalHits = collectExactStringLiteralHits(source, DISALLOWED_SURFACE_LITERALS);

    for (const hit of literalHits) {
      forbiddenHits.push(`${relativePath}:${hit.index} -> "${hit.literal}"`);
    }
  }

  assert.deepEqual(
    forbiddenHits,
    [],
    `Kernel must not hardcode concrete surface ids:\n${forbiddenHits.join("\n")}`
  );
});

test("kernel uses \"public\" literal only in policy files", () => {
  const files = walkFiles(KERNEL_ROOT);
  const disallowedPublicHits = [];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    const relativePath = toRelativePath(filePath);
    const publicHits = collectExactStringLiteralHits(source, new Set(["public"]));
    if (publicHits.length < 1) {
      continue;
    }
    if (ALLOWED_PUBLIC_LITERAL_FILES.has(relativePath)) {
      continue;
    }
    for (const hit of publicHits) {
      disallowedPublicHits.push(`${relativePath}:${hit.index} -> "public"`);
    }
  }

  assert.deepEqual(
    disallowedPublicHits,
    [],
    `Kernel must not treat "public" as a hardcoded surface default:\n${disallowedPublicHits.join("\n")}`
  );
});
