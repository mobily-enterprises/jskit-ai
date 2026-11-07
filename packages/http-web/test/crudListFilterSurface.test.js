import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

test("http-web exposes client-side CRUD list filter definition helpers", async () => {
  const { defineCrudListFilters } = await import("@jskit-ai/http-web/client/filters");

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

test("CrudListFilterSurface is one Material 3 chip row over a filter sheet, without owning server semantics", async () => {
  const componentsDir = path.join(PACKAGE_DIR, "src", "client", "components");
  const surfaceSource = await readFile(path.join(componentsDir, "CrudListFilterSurface.vue"), "utf8");
  const sheetSource = await readFile(path.join(componentsDir, "CrudListFilterSheet.vue"), "utf8");
  const controlsSource = await readFile(path.join(componentsDir, "CrudListFilterControls.vue"), "utf8");
  const source = `${surfaceSource}\n${sheetSource}\n${controlsSource}`;

  assert.match(sheetSource, /<CrudListFilterControls[^>]*:runtime="props\.runtime"[^>]*\bstacked\b[^>]*\/>/);
  assert.match(surfaceSource, /<v-bottom-sheet v-if="isCompact" v-model="sheetOpen">\s*<CrudListFilterSheet/);
  assert.match(surfaceSource, /<v-dialog v-else v-model="sheetOpen" max-width="560">\s*<CrudListFilterSheet/);
  assert.match(surfaceSource, /useShellWindowSizeClass/);
  assert.match(surfaceSource, /prepend-icon="\$tune"/);
  assert.match(surfaceSource, /v-for="filter in flagFilters"[\s\S]*:aria-pressed=/);
  // material-web draws an aria-pressed chip as a filter chip, so the flag chips set no look of their own.
  const flagChip = surfaceSource.match(/<v-chip\s+v-for="filter in flagFilters"[^>]*>/u)?.[0] || "";
  assert.doesNotMatch(flagChip, /:variant=|:color=|prepend-icon/u);
  assert.match(surfaceSource, /v-for="chip in valueChips"[\s\S]*closable/);

  assert.match(source, /defineProps/);
  assert.match(source, /v-if="shouldRender"/);
  assert.match(source, /filterEntries/);
  assert.match(source, /runtimeValues\[filter\.key\]/);
  assert.match(source, /activeChips/);
  assert.match(source, /clearChip/);
  assert.match(source, /clearFilters/);
  assert.match(source, /CrudListDateFilterControl/);
  assert.match(source, /crud-list-filter-surface__range--date/);
  assert.match(source, /grid-column:\s*span 2/);
  assert.doesNotMatch(`${surfaceSource}\n${sheetSource}`, /@media|<v-sheet|\sborder(?=[\s>])|\bborder\s*:|min-height:\s*48px/u);
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
  assert.match(source, />\s*\{\{ t\("jskit\.http\.actions\.clear"\) \}\}\s*</u);
  assert.match(source, />\s*\{\{ t\("jskit\.http\.actions\.close"\) \}\}\s*</u);
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
