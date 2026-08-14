import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

async function readComponent(name) {
  return readFile(path.join(PACKAGE_DIR, "src", "client", "components", name), "utf8");
}

async function readClientFile(...parts) {
  return readFile(path.join(PACKAGE_DIR, "src", "client", ...parts), "utf8");
}

test("CRUD screen components own generated list/view/form chrome centrally", async () => {
  const listSource = await readComponent("CrudListScreen.vue");
  const viewSource = await readComponent("CrudViewScreen.vue");
  const addEditSource = await readComponent("CrudAddEditScreen.vue");
  const deleteActionSource = await readComponent("CrudDeleteAction.vue");

  assert.match(listSource, /CrudListBulkActionSurface/);
  assert.match(listSource, /CrudListFilterSurface/);
  assert.match(listSource, /CrudListRecordActionMenu/);
  assert.match(listSource, /class="ui-generator-list-cards"/);
  assert.match(listSource, /class="ui-generator-list-table"/);
  assert.match(listSource, /class="ui-generator-list-fab"/);
  assert.doesNotMatch(listSource, /ui-generator-list-cards d-md-none/);
  assert.doesNotMatch(listSource, /ui-generator-list-table d-none d-md-block/);
  assert.doesNotMatch(listSource, /class="ui-generator-list-fab d-md-none"/);
  assert.match(listSource, /\.ui-generator-list-table\s*\{\s*display:\s*none;/);
  assert.match(
    listSource,
    /@media \(min-width: 960px\)[\s\S]*\.ui-generator-list-cards\s*\{\s*display:\s*none;[\s\S]*\.ui-generator-list-table\s*\{\s*display:\s*block;[\s\S]*\.ui-generator-list-fab\s*\{\s*display:\s*none;/
  );
  assert.match(listSource, /button-label="More"/);
  assert.match(listSource, /selectableRows/);
  assert.match(
    listSource,
    /\.ui-generator-list-element :deep\(\.v-btn\)\s*\{\s*min-height:\s*48px;/
  );
  assert.match(listSource, /<slot[\s\S]*name="card-fields"/);
  assert.match(listSource, /<slot name="table-header"/);
  assert.match(listSource, /<slot[\s\S]*name="table-row"/);
  assert.match(listSource, /:row="row"/);

  assert.match(viewSource, /generated-ui-screen generated-ui-screen--operator ui-generator-view-element/);
  assert.match(viewSource, /ui-generator-view-panel/);
  assert.match(viewSource, /@click="view\.refresh"/);
  assert.match(viewSource, /<slot name="actions" :screen="screen" :view="view" \/>/);
  assert.match(viewSource, /<slot name="before-fields"/);
  assert.match(viewSource, /<slot name="fields"/);
  assert.match(viewSource, /<slot name="after-fields"/);
  assert.match(viewSource, /supporting-content/);

  assert.match(addEditSource, /generated-ui-screen generated-ui-screen--operator ui-generator-add-edit-form/);
  assert.match(addEditSource, /addEdit\.canRetryLoad/);
  assert.match(addEditSource, /@click="addEdit\.refresh"/);
  assert.match(addEditSource, /<slot[\s\S]*name="fields"/);

  assert.match(deleteActionSource, /@click="action\.request"/);
  assert.match(deleteActionSource, /@click="action\.confirm"/);
  assert.match(deleteActionSource, /@click="closeDialog"/);
  assert.doesNotMatch(deleteActionSource, /\bactivator=/);
});

test("CRUD screen composables expose generated page extension inputs", async () => {
  const listSource = await readClientFile("composables", "useCrudListScreen.js");
  const viewSource = await readClientFile("composables", "useCrudViewScreen.js");

  assert.match(listSource, /listRowActions = \[\]/);
  assert.match(listSource, /syntheticRows = null/);
  assert.match(listSource, /readEnabled = true/);
  assert.match(listSource, /useCrudListRowActions/);
  assert.match(listSource, /selectableRows/);
  assert.match(listSource, /readEnabled,\n\s+requestRecoveryLabel/);

  assert.match(viewSource, /requestQueryParams = null/);
  assert.match(viewSource, /readEnabled = true/);
  assert.match(viewSource, /queryKeyFactory = null/);
  assert.match(viewSource, /requestQueryParams/);
  assert.match(viewSource, /readEnabled/);
});

test("CRUD screen composables are importable package APIs", async () => {
  const [
    listModule,
    viewModule,
    addEditModule,
    rowActionsModule,
    rowActionsRuntimeModule,
    deleteActionModule
  ] = await Promise.all([
    import("@jskit-ai/http-web/client/composables/useCrudListScreen"),
    import("@jskit-ai/http-web/client/composables/useCrudViewScreen"),
    import("@jskit-ai/http-web/client/composables/useCrudAddEditScreen"),
    import("@jskit-ai/http-web/client/rowActions"),
    import("@jskit-ai/http-web/client/composables/useCrudListRowActions"),
    import("@jskit-ai/http-web/client/composables/useCrudDeleteAction")
  ]);

  assert.equal(typeof listModule.useCrudListScreen, "function");
  assert.equal(typeof viewModule.useCrudViewScreen, "function");
  assert.equal(typeof addEditModule.useCrudAddEditScreen, "function");
  assert.equal(typeof rowActionsModule.defineCrudListRowActions, "function");
  assert.equal(typeof rowActionsRuntimeModule.useCrudListRowActions, "function");
  assert.equal(typeof deleteActionModule.useCrudDeleteAction, "function");
});
