import assert from "node:assert/strict";
import test from "node:test";
import { markRaw, nextTick, ref, shallowRef } from "vue";
import { createPinia } from "pinia";
import { useShellErrorHost } from "../src/client/composables/useShellErrorHost.js";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "../src/client/error/inject.js";
import { createErrorPresentationStore } from "../src/client/error/store.js";
import { useShellErrorPresentationStore } from "../src/client/stores/useShellErrorPresentationStore.js";
import { mountComposable } from "./support/mountComposable.js";

function mountHost(t, { top = 0, width = 1280 } = {}) {
  const heights = new Map();
  // The open modal surfaces the page holds, by the selector the host looks them up with.
  const openSurfaces = [];
  globalThis.document = {
    documentElement: {
      style: {
        setProperty: (name, value) => heights.set(name, value),
        removeProperty: (name) => heights.delete(name)
      }
    },
    querySelector: (selector) => openSurfaces.find((surface) => selector.split(", ").includes(surface)) || null
  };
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    observe(element) {
      this.element = element;
    }

    disconnect() {
      this.element = null;
    }
  };
  t.after(() => {
    delete globalThis.document;
    delete globalThis.ResizeObserver;
  });

  const pinia = createPinia();
  const store = createErrorPresentationStore();
  useShellErrorPresentationStore(pinia).attachRuntimeStore(store);
  const reports = [];
  const layoutRect = shallowRef({ top, left: 0, right: 0, bottom: 0 });
  const windowWidth = ref(width);
  const { app, result } = mountComposable(useShellErrorHost, {
    plugins: [pinia],
    provide: [
      [SHELL_WEB_ERROR_RUNTIME_KEY, { report: (event) => reports.push(event) }],
      [Symbol.for("vuetify:layout"), { mainRect: layoutRect }],
      [Symbol.for("vuetify:display"), { width: windowWidth, mobile: ref(false) }]
    ]
  });
  return { app, heights, host: result, layoutRect, observers, openSurfaces, reports, store, windowWidth };
}

test("snackbars show one at a time and the next opens after the last one leaves", async (t) => {
  const { app, host, store } = mountHost(t);
  const first = store.present("snackbar", { message: "First" });
  store.present("snackbar", { message: "Second" });
  await nextTick();

  assert.equal(host.displayedSnackbarEntry.value.id, first);
  assert.equal(host.snackbarOpen.value, true);

  host.onSnackbarModelValue(false);
  await nextTick();
  assert.equal(host.snackbarOpen.value, false);
  assert.equal(host.displayedSnackbarEntry.value.id, first);

  host.onSnackbarAfterLeave();
  assert.equal(host.displayedSnackbarEntry.value.message, "Second");
  assert.equal(host.snackbarOpen.value, true);

  host.onSnackbarModelValue(false);
  await nextTick();
  host.onSnackbarAfterLeave();
  assert.equal(host.displayedSnackbarEntry.value, null);
  assert.equal(host.snackbarOpen.value, false);
  app.unmount();
});

test("a message that shows over an open modal surface sits at the top of a compact window", async (t) => {
  const { app, host, openSurfaces, store, windowWidth } = mountHost(t, { width: 390 });
  store.present("snackbar", { message: "Shown over the page" });
  await nextTick();
  assert.equal(host.snackbarLocation.value, "bottom start");
  host.onSnackbarModelValue(false);
  await nextTick();
  host.onSnackbarAfterLeave();

  for (const surface of [".v-dialog.v-overlay--active", ".v-navigation-drawer--temporary.v-navigation-drawer--active"]) {
    openSurfaces.splice(0, openSurfaces.length, surface);
    store.present("snackbar", { message: "Shown over a modal surface" });
    await nextTick();
    assert.equal(host.snackbarLocation.value, "top", surface);
    // Wider windows keep it at the bottom start: a centred surface ends above the window's bottom edge.
    windowWidth.value = 1024;
    assert.equal(host.snackbarLocation.value, "bottom start", surface);
    windowWidth.value = 390;
    // It keeps its place while it shows, though the surface closes under it.
    openSurfaces.length = 0;
    await nextTick();
    assert.equal(host.snackbarLocation.value, "top", surface);
    host.onSnackbarModelValue(false);
    await nextTick();
    host.onSnackbarAfterLeave();
  }
  app.unmount();
});

test("a dialog closes on request unless it persists", async (t) => {
  const { app, host, store } = mountHost(t);
  store.present("dialog", { message: "Closable" });
  await nextTick();
  host.onDialogModelValue(false);
  await nextTick();
  assert.equal(host.dialogEntry.value, null);

  store.present("dialog", { message: "Stays", persist: true });
  await nextTick();
  host.onDialogModelValue(false);
  await nextTick();
  assert.equal(host.dialogEntry.value.message, "Stays");
  app.unmount();
});

test("a failed action reports through the shell and still dismisses its entry", async (t) => {
  const { app, host, reports, store } = mountHost(t);
  store.present("snackbar", { message: "Saved" });
  await nextTick();
  const failure = new Error("Undo failed");

  await host.runAction(host.displayedSnackbarEntry.value, {
    async handler() {
      throw failure;
    }
  });

  assert.equal(reports[0].cause, failure);
  assert.equal(reports[0].intent, "blocking");
  assert.equal(store.getState().channels.snackbar.length, 0);
  app.unmount();
});

test("an action can keep its entry open", async (t) => {
  const { app, host, store } = mountHost(t);
  store.present("snackbar", { message: "Saved" });
  await nextTick();

  await host.runAction(host.displayedSnackbarEntry.value, { handler() {}, dismissOnRun: false });

  assert.equal(store.getState().channels.snackbar.length, 1);
  app.unmount();
});

test("inline banners publish their height and withdraw it when they float or go", async (t) => {
  const { app, heights, host, layoutRect, observers } = mountHost(t);
  const element = markRaw({ getBoundingClientRect: () => ({ height: 40.2 }) });
  assert.equal(host.bannerPlacement.value.inline, true);

  host.bannersElement.value = element;
  await nextTick();
  assert.equal(heights.get("--shell-error-banners-inline-height"), "41px");
  assert.equal(observers[0].element, element);

  layoutRect.value = { top: 64, left: 0, right: 0, bottom: 0 };
  await nextTick();
  assert.equal(host.bannerPlacement.value.inline, false);
  assert.equal(heights.size, 0);
  assert.equal(observers[0].element, null);

  layoutRect.value = { top: 0, left: 0, right: 0, bottom: 0 };
  await nextTick();
  assert.equal(heights.size, 1);

  app.unmount();
  assert.equal(heights.size, 0);
});
