import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";

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
  assert.match(source, /CrudListDateFilterControl/);
  assert.match(source, /crud-list-filter-surface__range--date/);
  assert.match(source, /grid-column:\s*span 2/);
  assert.doesNotMatch(source, /type="date"/);
  assert.doesNotMatch(source, /useCrudList\(/);
  assert.doesNotMatch(source, /apiSuffix|server|repository/);
});

test("CrudListDateFilterControl composes stable Vuetify picker components accessibly", async () => {
  const componentPath = path.join(
    PACKAGE_DIR,
    "src",
    "client",
    "components",
    "CrudListDateFilterControl.vue"
  );
  const source = await readFile(componentPath, "utf8");

  assert.match(source, /<v-menu/);
  assert.match(source, /<v-text-field/);
  assert.match(source, /<v-date-picker/);
  assert.match(source, /append-inner-icon="\$calendar"/);
  assert.match(source, /:aria-label="label"/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /v-bind="\{ \.\.\.attrs, \.\.\.activatorProps \}"/);
  assert.match(source, /\["Enter", " ", "ArrowDown"\]/);
  assert.match(source, /role="dialog"/);
  assert.match(source, />\s*Clear\s*</u);
  assert.match(source, />\s*Close\s*</u);
  assert.doesNotMatch(source, /VDateInput|vuetify\/labs|type="date"/);

  const { descriptor, errors: parseErrors } = parse(source, { filename: componentPath });
  assert.deepEqual(parseErrors, []);
  const script = compileScript(descriptor, {
    id: "crud-list-date-filter-control"
  });
  const compiled = compileTemplate({
    id: "crud-list-date-filter-control",
    filename: componentPath,
    source: descriptor.template.content,
    scoped: descriptor.styles.some((style) => style.scoped),
    compilerOptions: {
      bindingMetadata: script.bindings
    }
  });
  assert.deepEqual(compiled.errors, []);
});
