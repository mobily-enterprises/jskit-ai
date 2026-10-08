import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { compileScript, parse } from "@vue/compiler-sfc";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

async function readComponent(name) {
  return readFile(path.join(PACKAGE_DIR, "src", "client", "components", name), "utf8");
}

async function readClientFile(...parts) {
  return readFile(path.join(PACKAGE_DIR, "src", "client", ...parts), "utf8");
}

test("every CRUD list create action retains its configured label and destination", async () => {
  const componentUrl = new URL("../src/client/components/CrudListScreen.vue", import.meta.url).href;
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith(".vue")) return nextLoad(url, context);
      if (url !== componentUrl) {
        return { format: "module", shortCircuit: true, source: "export default { render: () => null };" };
      }
      const { descriptor } = parse(readFileSync(new URL(url), "utf8"));
      return {
        format: "module", shortCircuit: true,
        source: compileScript(descriptor, { id: "crud-list-create-label", inlineTemplate: true }).content
      };
    }
  });
  let CrudListScreen;
  try {
    ({ default: CrudListScreen } = await import(componentUrl));
  } finally {
    hooks.deregister();
  }

  for (const populated of [false, true]) {
    for (const createLabel of [undefined, "Add book"]) {
      const screen = {
        records: {}, listPrimaryAction: "/books/new",
        displayRows: populated ? [{ key: "1", recordKey: "1", record: { title: "Kindred" } }] : [],
        resolveRecordTitle: (record) => record.title
      };
      const app = createSSRApp({ render: () => h(CrudListScreen, {
        screen, ...(createLabel === undefined ? {} : { createLabel })
      }) });
      const router = createRouter({
        history: createMemoryHistory(), routes: [{ path: "/books", component: { render: () => null } }]
      });
      await router.push("/books");
      app.use(router);
      app.component("VBtn", defineComponent({
        props: ["to"], setup: (props, { slots }) => () => h("a", { href: props.to }, slots.default?.())
      }));
      for (const name of ["VSheet", "VTable", "VTextField", "VSkeletonLoader", "VCheckboxBtn"]) {
        app.component(name, defineComponent({ setup: (_props, { slots }) => () => h("div", slots.default?.()) }));
      }
      const html = await renderToString(app);
      const labels = [...html.matchAll(/<a[^>]*href="\/books\/new"[^>]*>(.*?)<\/a>/gs)]
        .map((match) => match[1].trim());
      assert.deepEqual(labels, Array(populated ? 2 : 3).fill(createLabel ?? "New record"));
    }
  }
});

test("CRUD screen components own list/view/form chrome centrally", async () => {
  const listSource = await readComponent("CrudListScreen.vue");
  const viewSource = await readComponent("CrudViewScreen.vue");
  const addEditSource = await readComponent("CrudAddEditScreen.vue");
  const deleteActionSource = await readComponent("CrudDeleteAction.vue");
  const bulkActionSource = await readComponent("CrudListBulkActionSurface.vue");
  const rowActionSource = await readComponent("CrudListRecordActionMenu.vue");

  assert.match(listSource, /CrudListBulkActionSurface/);
  assert.match(listSource, /CrudListFilterSurface/);
  assert.match(listSource, /CrudListRecordActionMenu/);
  assert.match(listSource, /class="crud-list-cards"/);
  assert.match(listSource, /class="crud-list-table"/);
  assert.match(listSource, /class="crud-list-fab"/);
  assert.doesNotMatch(listSource, /crud-list-cards d-md-none/);
  assert.doesNotMatch(listSource, /crud-list-table d-none d-md-block/);
  assert.doesNotMatch(listSource, /class="crud-list-fab d-md-none"/);
  assert.match(listSource, /\.crud-list-table\s*\{\s*display:\s*none;/);
  assert.match(
    listSource,
    /@media \(min-width: 960px\)[\s\S]*\.crud-list-cards\s*\{\s*display:\s*none;[\s\S]*\.crud-list-table\s*\{\s*display:\s*block;[\s\S]*\.crud-list-fab\s*\{\s*display:\s*none;/
  );
  assert.match(listSource, /button-label="More"/);
  assert.match(listSource, /selectableRows/);
  assert.match(
    listSource,
    /\.crud-list-element :deep\(\.v-btn\)\s*\{\s*min-height:\s*48px;/
  );
  assert.match(listSource, /<slot[\s\S]*name="card-fields"/);
  assert.match(listSource, /<slot name="table-header"/);
  assert.match(listSource, /<slot[\s\S]*name="table-row"/);
  assert.match(listSource, /:row="row"/);

  assert.match(viewSource, /crud-screen crud-screen--operator crud-view-element/);
  assert.match(viewSource, /crud-view-panel/);
  assert.match(viewSource, /@click="view\.refresh"/);
  assert.match(viewSource, /<slot name="actions" :screen="screen" :view="view" \/>/);
  assert.match(viewSource, /<slot name="before-fields"/);
  assert.match(viewSource, /<slot name="fields"/);
  assert.match(viewSource, /<slot name="after-fields"/);
  assert.match(viewSource, /supporting-content/);

  assert.match(addEditSource, /crud-screen crud-screen--operator crud-add-edit-form/);
  assert.match(addEditSource, /addEdit\.canRetryLoad/);
  assert.match(addEditSource, /@click="addEdit\.refresh"/);
  assert.match(addEditSource, /<slot[\s\S]*name="fields"/);

  assert.match(deleteActionSource, /@click="action\.request"/);
  assert.match(deleteActionSource, /@click="action\.confirm"/);
  assert.match(deleteActionSource, /@click="closeDialog"/);
  assert.doesNotMatch(deleteActionSource, /\bactivator=/);

  const sharedSources = [
    listSource,
    viewSource,
    addEditSource,
    deleteActionSource,
    bulkActionSource,
    rowActionSource
  ].join("\n");
  assert.doesNotMatch(sharedSources, /:loading=|v-progress-(?:circular|linear)/u);
  assert.doesNotMatch(sharedSources, /ui-generator|generated-ui/u);
  assert.match(listSource, /v-skeleton-loader/u);
  assert.match(viewSource, /v-skeleton-loader/u);
  assert.match(addEditSource, /v-skeleton-loader/u);
});

test("CRUD screen composables expose page extension inputs", async () => {
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
  assert.doesNotMatch(`${listSource}\n${viewSource}`, /ui-generator/u);
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
