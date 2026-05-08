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
  assert.match(source, /useDisplay/);
  assert.match(source, /v-if="shouldRender"/);
  assert.match(source, /selectedCount/);
  assert.match(source, /hasActions/);
  assert.match(source, /hasSelection/);
  assert.match(source, /v-menu/);
  assert.match(source, /Bulk actions/);
  assert.match(source, /min-height:\s*48px/);
  assert.doesNotMatch(source, /useCrudList\(/);
  assert.doesNotMatch(source, /apiSuffix|repository|server/);
});
