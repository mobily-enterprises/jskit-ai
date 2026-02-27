import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGES_DIR = path.join(ROOT_DIR, "packages");
const APPS_DIR = path.join(ROOT_DIR, "apps");
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

const REMOVED_PACKAGE_IMPORTS = Object.freeze([
  "@jskit-ai/knex-mysql-core",
  "@jskit-ai/assistant-fastify-adapter",
  "@jskit-ai/assistant-transcripts-knex-mysql",
  "@jskit-ai/chat-fastify-adapter",
  "@jskit-ai/chat-knex-mysql",
  "@jskit-ai/communications-fastify-adapter",
  "@jskit-ai/observability-fastify-adapter",
  "@jskit-ai/security-audit-knex-mysql",
  "@jskit-ai/social-fastify-adapter",
  "@jskit-ai/social-knex-mysql",
  "@jskit-ai/user-profile-knex-mysql",
  "@jskit-ai/workspace-console-knex-mysql",
  "@jskit-ai/workspace-fastify-adapter",
  "@jskit-ai/workspace-knex-mysql"
]);

const MERGED_TARGET_SEGMENTS = Object.freeze([
  "packages/ai-agent/assistant-core/",
  "packages/ai-agent/assistant-transcripts-core/",
  "packages/chat/chat-core/",
  "packages/communications/communications-core/",
  "packages/observability/observability-core/",
  "packages/security/security-audit-core/",
  "packages/social/social-core/",
  "packages/users/user-profile-core/",
  "packages/workspace/workspace-console-service-core/",
  "packages/workspace/workspace-service-core/"
]);

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function listFilesRecursive(rootDir, predicate = () => true) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (predicate(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function parseImportSpecifiers(sourceText) {
  const specifiers = [];
  const importExportPattern = /(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of sourceText.matchAll(importExportPattern)) {
    specifiers.push(String(match[1] || ""));
  }

  for (const match of sourceText.matchAll(dynamicImportPattern)) {
    specifiers.push(String(match[1] || ""));
  }

  return specifiers;
}

function listJsFiles() {
  return [
    ...listFilesRecursive(PACKAGES_DIR, (absolutePath) => JS_EXTENSIONS.has(path.extname(absolutePath))),
    ...listFilesRecursive(APPS_DIR, (absolutePath) => JS_EXTENSIONS.has(path.extname(absolutePath)))
  ];
}

test("server db guardrail: removed package imports are not used", () => {
  const violations = [];

  for (const filePath of listJsFiles()) {
    const relativePath = toPosixPath(path.relative(ROOT_DIR, filePath));
    const source = readFileSync(filePath, "utf8");
    const importSpecifiers = parseImportSpecifiers(source);

    for (const forbiddenImport of REMOVED_PACKAGE_IMPORTS) {
      if (importSpecifiers.some((specifier) => specifier === forbiddenImport || specifier.startsWith(`${forbiddenImport}/`))) {
        violations.push(`${relativePath}: ${forbiddenImport}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("server db guardrail: merged target packages avoid raw dialect SQL strings", () => {
  const violations = [];

  for (const filePath of listJsFiles()) {
    const relativePath = toPosixPath(path.relative(ROOT_DIR, filePath));
    const isMergedTarget = MERGED_TARGET_SEGMENTS.some((segment) => relativePath.startsWith(segment));
    if (!isMergedTarget) {
      continue;
    }
    if (!relativePath.includes("/src/")) {
      continue;
    }

    const source = readFileSync(filePath, "utf8");
    if (/JSON_UNQUOTE\s*\(\s*JSON_EXTRACT\s*\(/.test(source)) {
      violations.push(`${relativePath}: JSON_UNQUOTE(JSON_EXTRACT(...))`);
    }
    if (/\bER_DUP_ENTRY\b/.test(source)) {
      violations.push(`${relativePath}: ER_DUP_ENTRY`);
    }
    if (/\berrno\s*===\s*1062\b/.test(source)) {
      violations.push(`${relativePath}: errno===1062`);
    }
  }

  assert.deepEqual(violations, []);
});
