import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectImportedPackages, collectRuntimeDependencyProblems } from "./check-runtime-dependencies.mjs";

test("runtime dependency scan finds static imports, re-exports and dynamic imports", () => {
  const source = [
    "import { ref } from \"vue\";",
    "export { y } from \"@jskit-ai/kernel/client\";",
    "const knex = await import(\"knex\");"
  ].join("\n");

  assert.deepEqual(collectImportedPackages(source).sort(), ["@jskit-ai/kernel", "knex", "vue"]);
});

test("runtime dependency scan ignores Node builtins, relative paths and comments", () => {
  const source = [
    "import { AsyncLocalStorage } from \"node:async_hooks\";",
    "import zlib from \"zlib\";",
    "import { helper } from \"./helper.js\";",
    "// import commented from \"commented-line\";",
    "/* import blocked from \"commented-block\"; */",
    "const glob = \"src/**/*.js\";",
    "import kept from \"kept-after-string\";"
  ].join("\n");

  assert.deepEqual(collectImportedPackages(source), ["kept-after-string"]);
});

test("runtime dependency scan reads only the script blocks of Vue files", () => {
  const source = [
    "<template><p>Don't import from \"template-text\"</p></template>",
    "<script setup>",
    "import { computed } from \"vue\";",
    "</script>"
  ].join("\n");

  assert.deepEqual(collectImportedPackages(source, { vue: true }), ["vue"]);
});

test("runtime dependency scan finds a CommonJS require", () => {
  const source = "const { helper } = require(\"@jskit-ai/kernel/server\");\nconst path = require(\"node:path\");";
  assert.deepEqual(collectImportedPackages(source), ["@jskit-ai/kernel"]);
});

test("a package's declared migration directories are scanned, so a migration's dynamic import must be declared", async (t) => {
  const packageDir = await mkdtemp(path.join(tmpdir(), "runtime-deps-"));
  t.after(() => rm(packageDir, { recursive: true, force: true }));
  await mkdir(path.join(packageDir, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(packageDir, "migrations", "constraints", "foreign_keys.cjs"), [
    "exports.up = async function up(knex) {",
    "  const { addMissingForeignKey } = await import(\"@jskit-ai/database-runtime/server/foreignKeyMigrations\");",
    "  await addMissingForeignKey(knex);",
    "};"
  ].join("\n"));
  const manifest = (dependencies) => JSON.stringify({ name: "@example/notes", dependencies, jskit: { migrations: { directories: ["migrations"] } } });

  await writeFile(path.join(packageDir, "package.json"), manifest({}));
  assert.deepEqual((await collectRuntimeDependencyProblems(packageDir)).missingDependencies, [
    { packageName: "@jskit-ai/database-runtime", files: ["migrations/constraints/foreign_keys.cjs"] }
  ]);
  await writeFile(path.join(packageDir, "package.json"), manifest({ "@jskit-ai/database-runtime": "0.1.262" }));
  assert.deepEqual((await collectRuntimeDependencyProblems(packageDir)).missingDependencies, []);
});
