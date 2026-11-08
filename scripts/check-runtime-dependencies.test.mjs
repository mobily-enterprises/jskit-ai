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

test("nothing a package's ./server loads imports an optional peer statically; a dynamic import or another subpath may", async (t) => {
  const packageDir = await mkdtemp(path.join(tmpdir(), "runtime-deps-"));
  t.after(() => rm(packageDir, { recursive: true, force: true }));
  await mkdir(path.join(packageDir, "src", "server", "repositories"), { recursive: true });
  await writeFile(path.join(packageDir, "package.json"), JSON.stringify({
    name: "@example/notes",
    exports: { "./server": "./src/server/index.js", "./server/storage": "./src/server/storage.js" },
    peerDependencies: { "@example/tables": "1.0.0" },
    peerDependenciesMeta: { "@example/tables": { optional: true } }
  }));
  await writeFile(path.join(packageDir, "src", "server", "index.js"), "export { NotesFeature } from \"./NotesFeature.js\";\n");
  await writeFile(path.join(packageDir, "src", "server", "NotesFeature.js"),
    "import { notesRepository } from \"./repositories/notesRepository.js\";\nconst load = () => import(\"@example/tables/server\");\nexport const NotesFeature = { notesRepository, load };\n");
  await writeFile(path.join(packageDir, "src", "server", "storage.js"), "export { createTables } from \"@example/tables/server\";\n");
  const repository = path.join(packageDir, "src", "server", "repositories", "notesRepository.js");

  await writeFile(repository, "// import { passedOn } from \"@example/tables/server\";\nexport const notesRepository = {};\n");
  assert.deepEqual((await collectRuntimeDependencyProblems(packageDir)).optionalPeerImports, []);
  await writeFile(repository, "import { passedOn } from \"@example/tables/server/callOptions\";\nexport const notesRepository = { passedOn };\n");
  assert.deepEqual((await collectRuntimeDependencyProblems(packageDir)).optionalPeerImports, [
    { packageName: "@example/tables", files: ["src/server/repositories/notesRepository.js"] }
  ]);
});
