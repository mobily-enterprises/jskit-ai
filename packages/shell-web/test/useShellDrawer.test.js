import assert from "node:assert/strict";
import test from "node:test";
import { computed, nextTick, ref } from "vue";
import { useShellDrawer } from "../src/client/composables/useShellDrawer.js";
import { installPage, mountComposable } from "./support/mountComposable.js";

const LABEL_TEXT_WIDTH = 150;

function createDrawerElement() {
  const label = { style: { display: "block", visibility: "visible" } };
  return {
    label,
    getBoundingClientRect: () => ({ left: 0, right: 248 }),
    querySelector: () => null,
    querySelectorAll: () => [label]
  };
}

function mountDrawer(t, { compact = false, props = {} } = {}) {
  const frames = [];
  const drawerElement = createDrawerElement();
  const fontListeners = new Set();
  const page = installPage(t, {
    window: {
      requestAnimationFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame(id) {
        frames[id - 1] = null;
      },
      getComputedStyle: (element) => element.style || { direction: "ltr", borderRightWidth: "1px" }
    },
    document: {
      fonts: {
        ready: Promise.resolve(),
        addEventListener: (_type, listener) => fontListeners.add(listener),
        removeEventListener: (_type, listener) => fontListeners.delete(listener)
      },
      getElementById: () => drawerElement,
      createRange: () => ({
        selectNodeContents() {},
        getBoundingClientRect: () => ({ left: 16, right: 16 + LABEL_TEXT_WIDTH, width: LABEL_TEXT_WIDTH })
      })
    }
  });
  const observers = [];
  globalThis.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      observers.push(this);
    }

    observe() {
      this.connected = true;
    }

    disconnect() {
      this.connected = false;
    }
  };
  t.after(() => {
    delete globalThis.MutationObserver;
  });

  const isCompactLayout = ref(compact);
  const viewportWidth = ref(compact ? 390 : 1280);
  const drawerOpen = ref(true);
  const focused = [];
  const navigationToggle = ref({ $el: { focus: (options) => focused.push(options) } });
  const { app, result } = mountComposable(() => useShellDrawer({
    props: {
      desktopDrawerClosedMode: "rail",
      drawerWidth: null,
      railWidth: 80,
      navigationItemSpacing: 12,
      ...props
    },
    modalLayout: isCompactLayout,
    viewportWidth,
    navigationToggle,
    layoutState: {
      drawerDefaultOpen: ref(true),
      drawerOpen,
      resolvedSurface: computed(() => "home"),
      setDrawerOpen(open) {
        drawerOpen.value = open;
      }
    }
  }));
  return { app, drawerOpen, focused, fontListeners, frames, isCompactLayout, observers, page, result, viewportWidth };
}

async function runFrames(frames) {
  await nextTick();
  await nextTick();
  for (const frame of frames.splice(0)) {
    frame?.();
  }
}

test("a compact layout closes the drawer and a wide one restores how it was left there", async (t) => {
  const { app, drawerOpen, isCompactLayout, result } = mountDrawer(t);
  assert.equal(drawerOpen.value, true);
  assert.equal(result.drawerPresentation.value.kind, "drawer");

  drawerOpen.value = false;
  await nextTick();
  assert.equal(result.drawerPresentation.value.kind, "rail");

  isCompactLayout.value = true;
  await nextTick();
  assert.equal(drawerOpen.value, false);
  assert.equal(result.drawerPresentation.value.kind, "modal");

  drawerOpen.value = true;
  await nextTick();
  isCompactLayout.value = false;
  await nextTick();
  assert.equal(drawerOpen.value, false);
  app.unmount();
});

test("a wide layout reopens a drawer left open there", async (t) => {
  const { app, drawerOpen, isCompactLayout } = mountDrawer(t);

  isCompactLayout.value = true;
  await nextTick();
  assert.equal(drawerOpen.value, false);

  isCompactLayout.value = false;
  await nextTick();
  assert.equal(drawerOpen.value, true);
  app.unmount();
});

test("a compact layout starts closed", (t) => {
  const { app, drawerOpen, result } = mountDrawer(t, { compact: true });
  assert.equal(drawerOpen.value, false);
  assert.equal(result.drawerPresentation.value.visible, false);
  app.unmount();
});

test("Escape closes the compact drawer and returns focus to its toggle", async (t) => {
  const { app, drawerOpen, focused, page } = mountDrawer(t, { compact: true });

  page.dispatch("keydown", { key: "Escape" });
  assert.deepEqual(focused, []);

  drawerOpen.value = true;
  await nextTick();
  page.dispatch("keydown", { key: "Enter" });
  assert.equal(drawerOpen.value, true);
  page.dispatch("keydown", { key: "Escape", defaultPrevented: true });
  assert.equal(drawerOpen.value, true);

  page.dispatch("keydown", { key: "Escape" });
  assert.equal(drawerOpen.value, false);
  await nextTick();
  await nextTick();
  assert.deepEqual(focused, [{ preventScroll: true }]);
  app.unmount();
});

test("the drawer is Material 3's 360dp wide and a modal one leaves 56dp of the page", async (t) => {
  const { app, frames, isCompactLayout, result, viewportWidth } = mountDrawer(t);
  assert.equal(result.fixedDrawerWidth.value, true);
  assert.equal(result.resolvedDrawerWidth.value, 360);
  await runFrames(frames);
  assert.equal(result.resolvedDrawerWidth.value, 360);

  isCompactLayout.value = true;
  viewportWidth.value = 390;
  assert.equal(result.resolvedDrawerWidth.value, 390 - 56);
  app.unmount();
});

test("a content drawer's width follows its measured labels", async (t) => {
  const { app, frames, observers, result } = mountDrawer(t, { props: { drawerWidth: "content" } });
  assert.equal(result.resolvedDrawerWidth.value, 248);

  await runFrames(frames);

  assert.equal(result.resolvedDrawerWidth.value, 16 + LABEL_TEXT_WIDTH + 12 + 1);
  assert.equal(observers.length, 1);
  assert.equal(observers[0].connected, true);
  app.unmount();
});

test("a fixed drawer width is never measured", async (t) => {
  const { app, frames, result } = mountDrawer(t, { props: { drawerWidth: 300 } });

  await runFrames(frames);

  assert.equal(result.fixedDrawerWidth.value, true);
  assert.equal(result.resolvedDrawerWidth.value, 300);
  assert.equal(frames.length, 0);
  app.unmount();
});

test("a closed wide drawer only ignores a request to open it", (t) => {
  const { app, drawerOpen, result } = mountDrawer(t);

  drawerOpen.value = false;
  result.handleDrawerVisibilityChange(true);
  assert.equal(drawerOpen.value, false);

  drawerOpen.value = true;
  result.handleDrawerVisibilityChange(false);
  assert.equal(drawerOpen.value, false);
  app.unmount();
});

test("unmounting detaches every listener and pending measurement", async (t) => {
  const { app, fontListeners, frames, observers, page } = mountDrawer(t, { props: { drawerWidth: "content" } });
  await nextTick();
  await nextTick();
  assert.equal(page.listeners.size, 2);
  assert.equal(fontListeners.size, 1);

  app.unmount();

  assert.equal(page.listeners.size, 0);
  assert.equal(fontListeners.size, 0);
  assert.equal(observers[0].connected, false);
  assert.deepEqual(frames.filter(Boolean), []);
});
