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

test("CRUD screen components own generated list/view/form chrome centrally", async () => {
  const listSource = await readComponent("CrudListScreen.vue");
  const viewSource = await readComponent("CrudViewScreen.vue");
  const addEditSource = await readComponent("CrudAddEditScreen.vue");

  assert.match(listSource, /CrudListBulkActionSurface/);
  assert.match(listSource, /CrudListFilterSurface/);
  assert.match(listSource, /ui-generator-list-cards d-md-none/);
  assert.match(listSource, /ui-generator-list-table d-none d-md-block/);
  assert.match(listSource, /class="ui-generator-list-fab d-md-none"/);
  assert.match(listSource, /#activator[\s\S]*Actions/);
  assert.match(listSource, /min-height:\s*48px/);
  assert.match(listSource, /<slot[\s\S]*name="card-fields"/);
  assert.match(listSource, /<slot name="table-header"/);
  assert.match(listSource, /<slot name="table-row"/);

  assert.match(viewSource, /generated-ui-screen generated-ui-screen--operator ui-generator-view-element/);
  assert.match(viewSource, /ui-generator-view-panel/);
  assert.match(viewSource, /@click="view\.refresh"/);
  assert.match(viewSource, /<slot name="fields"/);

  assert.match(addEditSource, /generated-ui-screen generated-ui-screen--operator ui-generator-add-edit-form/);
  assert.match(addEditSource, /addEdit\.canRetryLoad/);
  assert.match(addEditSource, /@click="addEdit\.refresh"/);
  assert.match(addEditSource, /<slot[\s\S]*name="fields"/);
});

test("CRUD screen composables are importable package APIs", async () => {
  const [
    listModule,
    viewModule,
    addEditModule
  ] = await Promise.all([
    import("@jskit-ai/users-web/client/composables/useCrudListScreen"),
    import("@jskit-ai/users-web/client/composables/useCrudViewScreen"),
    import("@jskit-ai/users-web/client/composables/useCrudAddEditScreen")
  ]);

  assert.equal(typeof listModule.useCrudListScreen, "function");
  assert.equal(typeof viewModule.useCrudViewScreen, "function");
  assert.equal(typeof addEditModule.useCrudAddEditScreen, "function");
});
