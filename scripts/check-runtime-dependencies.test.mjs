import assert from "node:assert/strict";
import test from "node:test";
import { collectImportedPackages } from "./check-runtime-dependencies.mjs";

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
