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
  const createActionUrl = import.meta.resolve("@jskit-ai/shell-web/client/components/ShellPrimaryAction");
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith(".vue")) return nextLoad(url, context);
      if (url === createActionUrl) {
        return {
          format: "module", shortCircuit: true,
          source: "import { h } from \"vue\"; export default { props: [\"label\", \"to\"], setup: (props) => () => h(\"a\", { href: props.to }, props.label) };"
        };
      }
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
        bulkActions: { hasActions: false },
        rowActions: { hasActions: false, hasVisibleActionsFor: () => false },
        displayRows: populated ? [{ key: "1", recordKey: "1", record: { title: "Kindred" } }] : [],
        selectableRows: [],
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
        props: { to: { type: [String, Object], default: undefined } },
        setup: (props, { slots }) => () => h("a", { href: props.to }, slots.default?.())
      }));
      for (const name of ["VCard", "VTable", "VTextField", "VSkeletonLoader", "VCheckboxBtn", "VIcon", "VTooltip"]) {
        app.component(name, defineComponent({ setup: (_props, { slots }) => () => h("div", slots.default?.()) }));
      }
      const html = await renderToString(app);
      const labels = [...html.matchAll(/<a[^>]*href="\/books\/new"[^>]*>(.*?)<\/a>/gs)]
        .map((match) => match[1].trim());
      // The FAB or app bar action, plus the empty state's own button.
      assert.deepEqual(labels, Array(populated ? 1 : 2).fill(createLabel ?? "New record"));
    }
  }
});

test("a CRUD view whose record is not found or forbidden tells the shell, and no other failure does", async () => {
  const componentUrl = new URL("../src/client/components/CrudViewScreen.vue", import.meta.url).href;
  const navigationStub = "export function useShellNavigation() { return { pageUnavailable: () => globalThis.__crudViewUnavailable.push(true) }; }";
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@jskit-ai/shell-web/client/navigation/useShellNavigation" && context.parentURL === componentUrl) {
        return { url: `data:text/javascript,${encodeURIComponent(navigationStub)}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (!url.endsWith(".vue")) return nextLoad(url, context);
      if (url !== componentUrl) {
        return { format: "module", shortCircuit: true, source: "export default { render: () => null };" };
      }
      const { descriptor } = parse(readFileSync(new URL(url), "utf8"));
      return {
        format: "module", shortCircuit: true,
        source: compileScript(descriptor, { id: "crud-view-unavailable", inlineTemplate: true }).content
      };
    }
  });
  let CrudViewScreen;
  try {
    ({ default: CrudViewScreen } = await import(componentUrl));
  } finally {
    hooks.deregister();
  }

  const cases = [
    { name: "not found", view: { isNotFound: true, errorStatus: 404, loadError: "" }, unavailable: 1 },
    { name: "forbidden", view: { isNotFound: false, errorStatus: 403, loadError: "No access" }, unavailable: 1 },
    { name: "server error", view: { isNotFound: false, errorStatus: 500, loadError: "Try again" }, unavailable: 0 },
    { name: "loaded", view: { isNotFound: false, errorStatus: 0, loadError: "" }, unavailable: 0 }
  ];
  for (const { name, view, unavailable } of cases) {
    globalThis.__crudViewUnavailable = [];
    const screen = { view: { ...view, isLoading: false, isFetching: false, refresh() {} }, editLocation: null, recordTitle: "" };
    const app = createSSRApp({ render: () => h(CrudViewScreen, { screen }) });
    for (const component of ["VBtn", "VCard", "VIcon", "VList", "VSkeletonLoader"]) {
      app.component(component, defineComponent({ setup: (_props, { slots }) => () => h("div", slots.default?.()) }));
    }
    await renderToString(app);
    assert.equal(globalThis.__crudViewUnavailable.length, unavailable, name);
  }
  delete globalThis.__crudViewUnavailable;
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
  // shell-web's adaptive primary action: an extended FAB on compact and medium windows, the bar's primary on wider.
  assert.match(listSource, /<ShellPrimaryAction v-if="listPrimaryAction" :label="resolvedCreateLabel" :to="listPrimaryAction" \/>/);
  assert.match(listSource, /<ShellPageActions>[\s\S]*icon="\$refresh"[\s\S]*<\/ShellPageActions>/);
  assert.match(listSource, /class="crud-list-cards"/);
  assert.match(listSource, /class="crud-list-table"/);
  assert.match(listSource, /\.crud-list-table\s*\{\s*display:\s*none;/);
  // The list's own width, not the window's, picks cards or the table.
  assert.match(listSource, /container: crud-list \/ inline-size;/);
  assert.match(
    listSource,
    /@container crud-list \(min-width: 720px\)[\s\S]*\.crud-list-cards\s*\{\s*display:\s*none;[\s\S]*\.crud-list-table\s*\{\s*display:\s*block;/
  );
  assert.match(listSource, /table-layout: fixed;/);
  assert.match(listSource, /text-overflow: ellipsis;/);
  assert.match(listSource, /@click="openRow\(row, \$event\)"/);
  assert.match(listSource, /class="crud-list-card__title crud-list-card__link"/);
  assert.match(listSource, /icon="\$inbox"/);
  assert.match(listSource, /icon="\$cloudOff"/);
  assert.match(listSource, /variant="solo-filled"[\s\S]*rounded="pill"[\s\S]*prepend-inner-icon="\$search"/);
  assert.doesNotMatch(listSource, /@media|<v-sheet|\sborder(?=[\s>])|\bborder\s*:|min-height:\s*48px/u);
  assert.match(listSource, /selectableRows/);
  assert.match(rowActionSource, /icon="\$moreVert"/);
  assert.match(listSource, /<slot[\s\S]*name="card-fields"/);
  assert.match(listSource, /<slot name="table-header"/);
  assert.match(listSource, /<slot[\s\S]*name="table-row"/);
  assert.match(listSource, /:row="row"/);

  assert.match(viewSource, /class="crud-screen crud-view"/);
  assert.match(viewSource, /crud-view-panel/);
  assert.match(viewSource, /@click="view\.refresh"/);
  assert.match(viewSource, /<ShellPageActions>\s*<slot name="actions" :screen="screen" :view="view" \/>/);
  assert.match(viewSource, /pageUnavailable\(\)/);
  assert.match(viewSource, /<v-list class="crud-view-fields" lines="two">/);
  assert.doesNotMatch(viewSource, /backTo|Back to/u);
  assert.match(viewSource, /<slot name="before-fields"/);
  assert.match(viewSource, /<slot name="fields"/);
  assert.match(viewSource, /<slot name="after-fields"/);
  assert.match(viewSource, /supporting-content/);

  assert.match(addEditSource, /class="crud-screen crud-add-edit-form"/);
  assert.match(addEditSource, /<ShellPageActions>\s*<slot\s+name="actions"/);
  assert.match(addEditSource, /<ShellPageAction\s+primary/);
  assert.match(addEditSource, /navigation\.finish\(/);
  assert.match(addEditSource, /addEdit\.canRetryLoad/);
  assert.match(addEditSource, /@click="addEdit\.refresh"/);
  assert.match(addEditSource, /<slot[\s\S]*name="fields"/);

  assert.match(deleteActionSource, /@click="action\.request"/);
  assert.match(deleteActionSource, /@click="action\.confirm"/);
  assert.match(deleteActionSource, /@click="closeDialog"/);
  assert.doesNotMatch(deleteActionSource, /\bactivator=/);
  assert.match(deleteActionSource, /<ShellPageAction\s+icon="\$delete"/);

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
  assert.doesNotMatch(sharedSources, /@mdi\/js|mdi-|!important/u);
  assert.match(listSource, /v-skeleton-loader/u);
  assert.match(viewSource, /v-skeleton-loader/u);
  assert.match(addEditSource, /v-skeleton-loader/u);
});

test("CRUD screen composables expose page extension inputs", async () => {
  const listSource = await readClientFile("composables", "useCrudListScreen.js");
  const viewSource = await readClientFile("composables", "useCrudViewScreen.js");

  assert.match(listSource, /listRowActions = NO_LIST_ACTIONS/);
  assert.match(listSource, /syntheticRows = null/);
  assert.match(listSource, /readEnabled = true/);
  assert.match(listSource, /useCrudListRowActions/);
  assert.match(listSource, /selectableRows/);
  assert.match(listSource, /readEnabled,\n\s+requestRecoveryLabel/);

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
