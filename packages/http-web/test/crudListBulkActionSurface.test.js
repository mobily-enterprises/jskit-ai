import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

test("CrudListBulkActionSurface stays adaptive and runtime-owned", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "CrudListBulkActionSurface.vue"),
    "utf8"
  );

  assert.match(source, /defineProps/);
  assert.match(source, /useShellWindowSizeClass/);
  assert.match(source, /v-if="shouldRender"/);
  assert.match(source, /selectedCount/);
  assert.match(source, /hasActions/);
  assert.match(source, /hasSelection/);
  assert.match(source, /v-menu/);
  assert.match(source, /jskit\.http\.crud\.bulk\.actions/);
  assert.match(source, /background: rgb\(var\(--v-theme-secondary-container\)\);/);
  assert.doesNotMatch(source, /\bborder(?:-block|-inline)?\s*:|min-height:\s*48px/u);
  assert.doesNotMatch(source, /useCrudList\(/);
  assert.doesNotMatch(source, /apiSuffix|repository|server/);
});
