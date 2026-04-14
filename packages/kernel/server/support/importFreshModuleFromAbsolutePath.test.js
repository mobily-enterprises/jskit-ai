import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { importFreshModuleFromAbsolutePath } from "./importFreshModuleFromAbsolutePath.js";

test("importFreshModuleFromAbsolutePath requires an absolute path", async () => {
  await assert.rejects(
    () => importFreshModuleFromAbsolutePath("relative/module.js"),
    /requires an absolute path/
  );
});

test("importFreshModuleFromAbsolutePath re-evaluates a module on each call", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "jskit-import-fresh-module-"));
  const modulePath = path.join(tempRoot, "counter.mjs");
  const counterKey = "__jskitKernelImportFreshCounter";
  delete globalThis[counterKey];

  await writeFile(
    modulePath,
    `globalThis.${counterKey} = Number(globalThis.${counterKey} || 0) + 1;
export const loadCount = globalThis.${counterKey};
`,
    "utf8"
  );

  const first = await importFreshModuleFromAbsolutePath(modulePath);
  const second = await importFreshModuleFromAbsolutePath(modulePath);

  assert.equal(first.loadCount, 1);
  assert.equal(second.loadCount, 2);

  delete globalThis[counterKey];
});
