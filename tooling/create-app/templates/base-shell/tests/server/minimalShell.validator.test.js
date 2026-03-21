import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, readdir, readFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "../..");

const EXPECTED_RUNTIME_DEPENDENCIES = Object.freeze([
  "@fastify/type-provider-typebox",
  "@jskit-ai/http-runtime",
  "@jskit-ai/kernel",
  "@local/main",
  "fastify",
  "vue",
  "vue-router",
  "vuetify"
]);

const EXPECTED_DEV_DEPENDENCIES = Object.freeze([
  "@jskit-ai/config-eslint",
  "@jskit-ai/jskit-cli",
  "@vitejs/plugin-vue",
  "eslint",
  "unplugin-vue-router",
  "vite",
  "vitest"
]);

const EXPECTED_TOP_LEVEL_ENTRIES = Object.freeze([
  "Procfile",
  "README.md",
  "bin",
  "config",
  "eslint.config.mjs",
  "favicon.svg",
  "index.html",
  "jsconfig.json",
  "package.json",
  "packages",
  "server.js",
  "scripts",
  "server",
  "src",
  "tests",
  "vite.config.mjs",
  "vite.shared.mjs"
]);

async function readPackageJson() {
  const packageJsonPath = path.join(APP_ROOT, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw);
}

function sortStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortedKeys(record) {
  return sortStrings(Object.keys(record || {}));
}

async function readTopLevelEntries() {
  const entries = await readdir(APP_ROOT, { withFileTypes: true });
  const ignored = new Set([
    "node_modules",
    "dist",
    "coverage",
    "test-results",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock"
  ]);
  return entries
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .filter((name) => !ignored.has(name));
}

async function listFilesRecursive(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(absolutePath)));
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}

test("minimal shell keeps strict dependency allowlist", async () => {
  const packageJson = await readPackageJson();
  assert.deepEqual(
    sortedKeys(packageJson.dependencies),
    [...EXPECTED_RUNTIME_DEPENDENCIES].sort((left, right) => left.localeCompare(right))
  );
  assert.deepEqual(
    sortedKeys(packageJson.devDependencies),
    [...EXPECTED_DEV_DEPENDENCIES].sort((left, right) => left.localeCompare(right))
  );
});

test("starter shell keeps a strict top-level footprint", async () => {
  const entries = await readTopLevelEntries();
  assert.deepEqual(sortStrings(entries), sortStrings(EXPECTED_TOP_LEVEL_ENTRIES));
});

test("legacy app.manifest scaffold is removed from starter shell", async () => {
  await assert.rejects(access(path.join(APP_ROOT, "framework/app.manifest.mjs")), /ENOENT/);
});

test("local package source avoids brittle deep relative imports", async () => {
  const packageSourceFiles = await listFilesRecursive(path.join(APP_ROOT, "packages"));
  const brittleImportPattern = /\bfrom\s+["'](?:\.\.\/){5,}[^"']+["']/;

  for (const filePath of packageSourceFiles) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".mjs")) {
      continue;
    }
    const source = await readFile(filePath, "utf8");
    assert.equal(
      brittleImportPattern.test(source),
      false,
      `Found brittle deep relative import in ${path.relative(APP_ROOT, filePath)}`
    );
  }
});
