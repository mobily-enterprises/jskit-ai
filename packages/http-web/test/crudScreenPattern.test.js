import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";

const execFileAsync = promisify(execFile);
const patternRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../patterns/crud-screen-set"
);
const exampleRoot = path.join(patternRoot, "example", "books");

test("CRUD screen pattern is thin app-owned source over shared public screens", async () => {
  const files = (await readdir(exampleRoot)).sort();
  const sources = await Promise.all(files.map((file) => readFile(path.join(exampleRoot, file), "utf8")));
  const combinedSource = sources.join("\n");

  assert.deepEqual(files, [
    "BookEditPage.vue",
    "BookFormFields.vue",
    "BookListPage.vue",
    "BookNewPage.vue",
    "BookViewPage.vue",
    "formFields.js",
    "listExtensions.js"
  ]);
  assert.match(combinedSource, /useCrudListScreen/u);
  assert.match(combinedSource, /useCrudViewScreen/u);
  assert.match(combinedSource, /useCrudAddEditScreen/u);
  assert.match(combinedSource, /useCrudDeleteAction/u);
  assert.doesNotMatch(combinedSource, /ui-generator|generated-ui|jskit:crud-ui|__JSKIT_/u);
  assert.doesNotMatch(combinedSource, /:loading=|v-progress-(?:circular|linear)/u);

  for (const file of files) {
    const absolutePath = path.join(exampleRoot, file);
    if (file.endsWith(".js")) {
      await execFileAsync(process.execPath, ["--check", absolutePath]);
      continue;
    }

    const source = await readFile(absolutePath, "utf8");
    const { descriptor, errors } = parse(source, { filename: absolutePath });
    assert.deepEqual(errors, []);
    if (descriptor.scriptSetup) {
      compileScript(descriptor, { id: `pattern-${file}` });
    }
    if (descriptor.template) {
      const result = compileTemplate({
        id: `pattern-${file}`,
        filename: absolutePath,
        source: descriptor.template.content
      });
      assert.deepEqual(result.errors, []);
    }
  }
});
