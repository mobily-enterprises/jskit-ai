import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

test("users-web exposes client-side CRUD list filter definition helpers", async () => {
  const { defineCrudListFilters } = await import("@jskit-ai/users-web/client/filters");

  const filters = defineCrudListFilters({
    status: {
      type: "enum",
      label: "Status",
      options: [
        { value: "active", label: "Active" }
      ]
    }
  });

  assert.equal(filters.status.queryKey, "status");
  assert.equal(filters.status.options[0].label, "Active");
});

test("CrudListFilterSurface provides adaptive controls without owning server semantics", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "CrudListFilterSurface.vue"),
    "utf8"
  );

  assert.match(source, /defineProps/);
  assert.match(source, /useDisplay/);
  assert.match(source, /v-if="shouldRender"/);
  assert.match(source, /filterEntries/);
  assert.match(source, /runtimeValues\[filter\.key\]/);
  assert.match(source, /activeChips/);
  assert.match(source, /clearChip/);
  assert.match(source, /clearFilters/);
  assert.match(source, /v-dialog/);
  assert.match(source, /min-height:\s*48px/);
  assert.doesNotMatch(source, /useCrudList\(/);
  assert.doesNotMatch(source, /apiSuffix|server|repository/);
});
