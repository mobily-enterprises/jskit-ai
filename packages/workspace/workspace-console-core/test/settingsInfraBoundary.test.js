import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as workspaceConsoleCore from "../src/shared/index.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_SRC_DIR = path.join(PACKAGE_ROOT, "src");

function listSourceFiles() {
  const entries = readdirSync(PACKAGE_SRC_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(PACKAGE_SRC_DIR, entry.name));
}

test("settings infra exports remain key-agnostic", () => {
  const forbiddenExports = [
    "SETTINGS_DEFAULTS",
    "SETTINGS_THEME_OPTIONS",
    "SETTINGS_FIELD_SPECS",
    "AVATAR_POLICY",
    "AVATAR_DEFAULT_SIZE"
  ];

  for (const exportName of forbiddenExports) {
    assert.equal(Object.hasOwn(workspaceConsoleCore, exportName), false, `${exportName} must not be exported.`);
  }

  assert.equal(typeof workspaceConsoleCore.buildPatch, "function");
  assert.equal(typeof workspaceConsoleCore.buildSchema, "function");
  assert.equal(typeof workspaceConsoleCore.toValidationError, "function");
});

test("workspace-console-core package does not import app-local modules", () => {
  const sourceFiles = listSourceFiles();

  for (const sourceFile of sourceFiles) {
    const source = readFileSync(sourceFile, "utf8");
    assert.equal(/from\s+["'][^"']*apps\//.test(source), false, `${path.basename(sourceFile)} imports from apps/.`);
    assert.equal(/from\s+["']\.\.\/\.\.\/\.\.\/apps\//.test(source), false, `${path.basename(sourceFile)} imports from apps/.`);
  }
});
