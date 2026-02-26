import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "../..");

const EXPECTED_RUNTIME_DEPENDENCIES = Object.freeze([
  "@jskit-ai/app-scripts",
  "fastify",
  "vue"
]);

const EXPECTED_DEV_DEPENDENCIES = Object.freeze([
  "@jskit-ai/config-eslint",
  "@vitejs/plugin-vue",
  "eslint",
  "vite",
  "vitest"
]);

const EXPECTED_TOP_LEVEL_ENTRIES = Object.freeze([
  "Procfile",
  "README.md",
  "app.scripts.config.mjs",
  "bin",
  "eslint.config.mjs",
  "favicon.svg",
  "framework",
  "gitignore",
  "index.html",
  "package.json",
  "server.js",
  "server",
  "src",
  "tests",
  "vite.config.mjs"
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

test("manifest scaffold exists with strict core-only defaults", async () => {
  const manifestModule = await import(path.join(APP_ROOT, "framework/app.manifest.mjs"));
  const manifest = manifestModule?.default;

  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.appId, "__APP_NAME__");
  assert.equal(manifest.profileId, "web-saas-default");
  assert.equal(manifest.mode, "strict");
  assert.equal(manifest.enforceProfileRequired, true);
  assert.deepEqual(manifest.optionalModulePacks, ["core"]);
});
