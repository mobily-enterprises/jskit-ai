import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { symlinkSafeRequire } from "./symlinkSafeRequire.js";

test("symlinkSafeRequire requires a non-empty module id", () => {
  assert.throws(() => symlinkSafeRequire(""), /requires a non-empty module id/);
});

test("symlinkSafeRequire resolves modules from app cwd node_modules", async () => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-symlink-safe-require-"));
  const knexPackageDir = path.join(appRoot, "node_modules", "knex");
  await mkdir(knexPackageDir, { recursive: true });
  await writeFile(path.join(knexPackageDir, "package.json"), JSON.stringify({ name: "knex", main: "index.js" }), "utf8");
  await writeFile(path.join(knexPackageDir, "index.js"), "module.exports = { source: 'app-cwd' };", "utf8");

  const previousCwd = process.cwd();
  try {
    process.chdir(appRoot);
    const loaded = symlinkSafeRequire("knex");
    assert.equal(loaded?.source, "app-cwd");
  } finally {
    process.chdir(previousCwd);
  }
});
