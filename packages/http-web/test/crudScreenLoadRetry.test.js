import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { compileScript, parse } from "@vue/compiler-sfc";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";

// The three CRUD screens, compiled from source. Their other components render nothing, and the shell's navigation
// stands in as a plain object, so only each screen's own load-error state renders.
const componentUrls = Object.freeze({
  list: new URL("../src/client/components/CrudListScreen.vue", import.meta.url).href,
  view: new URL("../src/client/components/CrudViewScreen.vue", import.meta.url).href,
  addEdit: new URL("../src/client/components/CrudAddEditScreen.vue", import.meta.url).href
});
const screenUrls = new Set(Object.values(componentUrls));
const SHELL_STUBS = Object.freeze({
  "@jskit-ai/shell-web/client/navigation/useShellNavigation": [
    "export function useShellNavigation() {",
    "  return { canGoUp: { value: false }, upTarget: { value: '' }, finish() {}, pageUnavailable() {} };",
    "}"
  ].join("\n"),
  "@jskit-ai/shell-web/client/composables/useShellPageClose": "export function useShellPageClose() {}"
});
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(SHELL_STUBS, specifier) && screenUrls.has(context.parentURL)) {
      return { url: `data:text/javascript,${encodeURIComponent(SHELL_STUBS[specifier])}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".vue")) return nextLoad(url, context);
    if (!screenUrls.has(url)) {
      return { format: "module", shortCircuit: true, source: "export default { render: () => null };" };
    }
    const { descriptor } = parse(readFileSync(new URL(url), "utf8"));
    return {
      format: "module",
      shortCircuit: true,
      source: compileScript(descriptor, {
        id: `crud-screen-load-retry-${[...screenUrls].indexOf(url)}`,
        inlineTemplate: true
      }).content
    };
  }
});
let screens;
try {
  screens = {
    list: (await import(componentUrls.list)).default,
    view: (await import(componentUrls.view)).default,
    addEdit: (await import(componentUrls.addEdit)).default
  };
} finally {
  hooks.deregister();
}

const VUETIFY_STUBS = Object.freeze([
  "VCard", "VCheckboxBtn", "VCol", "VDivider", "VFab", "VForm", "VIcon", "VList", "VListItem", "VRow",
  "VSkeletonLoader", "VTable", "VTextField", "VTooltip"
]);

const HTML_ENTITIES = Object.freeze({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" });

// The screen's load-error state, given its runtime: the text it shows and whether it shows its Retry button.
async function renderLoadError(screen, Component) {
  const app = createSSRApp({ render: () => h(Component, { screen }) });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/books/:recordId?", component: { render: () => null } }]
  });
  await router.push("/books/7");
  app.use(router);
  app.component("VBtn", defineComponent({ setup: (_props, { slots }) => () => h("button", slots.default?.()) }));
  for (const name of VUETIFY_STUBS) {
    app.component(name, defineComponent({ setup: (_props, { slots }) => () => h("div", slots.default?.()) }));
  }
  const html = await renderToString(app);
  const text = html.match(/<p class="text-body-large">([^<]*)<\/p>/u)?.[1];
  assert.notEqual(text, undefined, "The load-error state renders.");
  return {
    text: text.replace(/&(?:amp|lt|gt|quot|#39);/gu, (entity) => HTML_ENTITIES[entity]),
    retry: /<button[^>]*>[^<]*\bRetry\b/u.test(html)
  };
}

async function showsRetry(screen, Component) {
  const { text, retry } = await renderLoadError(screen, Component);
  assert.match(text, /Unable to load books\.|Check the connection/u, "The load-error state renders.");
  return retry;
}

// A status of `undefined` is a runtime that has no `errorStatus` (one a page builds), which keeps its Retry.
const LOAD_FAILURES = Object.freeze([
  { status: 0, retry: true },
  { status: 503, retry: true },
  { status: undefined, retry: true },
  { status: 401, retry: false },
  { status: 403, retry: false },
  { status: 422, retry: false }
]);

const SCREENS = Object.freeze({
  list: (errorStatus, { loadRefusalMessage } = {}) => ({
    records: {
      loadError: "Unable to load books.",
      ...(errorStatus === undefined ? {} : { errorStatus }),
      ...(loadRefusalMessage === undefined ? {} : { loadRefusalMessage }),
      isFetching: false,
      showListSkeleton: false,
      searchEnabled: false,
      reload() {}
    },
    listPrimaryAction: "",
    bulkActions: { hasActions: false },
    rowActions: { hasActions: false, hasVisibleActionsFor: () => false },
    displayRows: [],
    selectableRows: [],
    resolveRecordTitle: (record) => record.title
  }),
  view: (errorStatus, { loadRefusalMessage } = {}) => ({
    view: {
      loadError: "Unable to load books.",
      ...(errorStatus === undefined ? {} : { errorStatus }),
      ...(loadRefusalMessage === undefined ? {} : { loadRefusalMessage }),
      isNotFound: false,
      isLoading: false,
      isFetching: false,
      refresh() {}
    },
    editLocation: null,
    recordTitle: ""
  }),
  addEdit: (errorStatus, { canRetryLoad = true, loadRefusalMessage } = {}) => ({
    mode: "edit",
    saveLabel: "Save book",
    cancelTo: "",
    formRuntime: { showFormSkeleton: false },
    addEdit: {
      loadError: "Unable to load books.",
      ...(errorStatus === undefined ? {} : { errorStatus }),
      ...(loadRefusalMessage === undefined ? {} : { loadRefusalMessage }),
      canRetryLoad,
      isFetching: false,
      isSaving: false,
      isSubmitDisabled: false,
      refresh() {},
      submit() {}
    },
    formState: {},
    resolveFieldErrors: () => [],
    resolveCancelTo: () => ""
  })
});

const SCREEN_NAMES = Object.freeze({ list: "CrudListScreen", view: "CrudViewScreen", addEdit: "CrudAddEditScreen" });

for (const [key, buildScreen] of Object.entries(SCREENS)) {
  for (const { status, retry } of LOAD_FAILURES) {
    const label = status === undefined ? "a runtime without errorStatus" : `a ${status} load failure`;
    test(`${SCREEN_NAMES[key]} ${retry ? "shows" : "hides"} its Retry button after ${label}`, async () => {
      assert.equal(await showsRetry(buildScreen(status), screens[key]), retry);
    });
  }
}

test("CrudAddEditScreen still shows no Retry while its form reads no record", async () => {
  assert.equal(await showsRetry(SCREENS.addEdit(503, { canRetryLoad: false }), screens.addEdit), false);
});

// What each screen says after a failed load. `refusal` is the runtime's `loadRefusalMessage` for it: empty where trying
// again may help, else the server's message or the neutral text for the refusal's kind.
const LOAD_ERROR_TEXTS = Object.freeze([
  { label: "a network failure", status: 0, refusal: "" },
  { label: "a 503", status: 503, refusal: "" },
  { label: "a 401 without a message", status: 401, refusal: "Sign in again to see this." },
  { label: "a 403 without a message", status: 403, refusal: "You don't have access to this." },
  { label: "a 404 without a message", status: 404, refusal: "This wasn't found." },
  { label: "a 422 without a message", status: 422, refusal: "This couldn't be loaded." },
  { label: "a 403 with the server's message", status: 403, refusal: "Only editors can read books." }
]);
// The text each screen showed before for a load trying again may fix: the list's connection advice, or the runtime's
// load error.
const RETRYABLE_TEXTS = Object.freeze({
  list: "Check the connection and try again.",
  view: "Unable to load books.",
  addEdit: "Unable to load books."
});

for (const [key, buildScreen] of Object.entries(SCREENS)) {
  for (const { label, status, refusal } of LOAD_ERROR_TEXTS) {
    const expected = refusal || RETRYABLE_TEXTS[key];
    test(`${SCREEN_NAMES[key]} says "${expected}" after ${label}`, async () => {
      const { text } = await renderLoadError(buildScreen(status, { loadRefusalMessage: refusal }), screens[key]);
      assert.equal(text, expected);
    });
  }
}

test("CrudListScreen gives a refusal from a runtime without loadRefusalMessage its load error, not the connection advice", async () => {
  const { text } = await renderLoadError(SCREENS.list(403), screens.list);
  assert.equal(text, "Unable to load books.");
});
