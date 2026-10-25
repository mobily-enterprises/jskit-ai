import assert from "node:assert/strict";
import test from "node:test";
import { createRenderer, defineComponent, nextTick, ref } from "vue";
import { useShellPullToRefresh } from "../src/client/composables/useShellPullToRefresh.js";

function node(type) {
  return { type, props: {}, children: [], parent: null, text: "" };
}

const renderer = createRenderer({
  createElement: node,
  createText: () => node("text"),
  createComment: () => node("comment"),
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: (item) => item.parent,
  nextSibling: () => null,
  insert(item, parent) {
    item.parent = parent;
    parent.children.push(item);
  },
  remove(item) {
    item.parent?.children.splice(item.parent.children.indexOf(item), 1);
  }
});

function installWindow() {
  const listeners = new Map();
  globalThis.window = {
    scrollY: 0,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    }
  };
  globalThis.document = { documentElement: { scrollTop: 0 }, body: { scrollTop: 0 } };
  return {
    listeners,
    dispatch(type, event) {
      listeners.get(type)?.({ preventDefault() {}, cancelable: true, target: { closest: () => null }, ...event });
    }
  };
}

function mountPull({ enabled = true } = {}) {
  const page = installWindow();
  const refreshes = [];
  const refreshRuntime = {
    async refresh(reason) {
      refreshes.push(reason);
    }
  };
  let pull = null;
  const app = renderer.createApp(defineComponent({
    setup() {
      pull = useShellPullToRefresh({ enabled: ref(enabled), refreshRuntime });
      return () => null;
    }
  }));
  app.mount(node("root"));
  return { app, page, pull, refreshes };
}

const touchPointer = { isPrimary: true, button: 0, pointerType: "touch", pointerId: 7 };

test("pull to refresh refreshes after a long enough pull and resets", async () => {
  const { app, page, pull, refreshes } = mountPull();

  page.dispatch("pointerdown", { ...touchPointer, clientX: 100, clientY: 10 });
  page.dispatch("pointermove", { ...touchPointer, clientX: 102, clientY: 210 });
  assert.equal(pull.pullDistance.value, 110);
  assert.equal(pull.pullRefreshLabel.value, "Release to refresh");
  assert.equal(pull.pullIndicatorVisible.value, true);

  page.dispatch("pointerup", { ...touchPointer });
  assert.deepEqual(refreshes, ["pull-to-refresh"]);
  await nextTick();
  await nextTick();
  assert.equal(pull.pullRefreshing.value, false);
  assert.equal(pull.pullDistance.value, 0);

  app.unmount();
  assert.equal(page.listeners.size, 0);
});

test("pull to refresh follows the touch after the browser cancels the pointer", () => {
  const { app, page, pull, refreshes } = mountPull();

  page.dispatch("pointerdown", { ...touchPointer, clientX: 100, clientY: 10 });
  page.dispatch("pointercancel", { ...touchPointer });
  page.dispatch("touchmove", { touches: [{ identifier: 1, clientX: 100, clientY: 60 }] });
  assert.equal(pull.pullDistance.value, 28);
  assert.equal(pull.pullRefreshLabel.value, "Pull to refresh");

  page.dispatch("touchend", { changedTouches: [{ identifier: 1 }] });
  assert.deepEqual(refreshes, []);
  assert.equal(pull.pullDistance.value, 0);
  app.unmount();
});

test("pull to refresh stays off outside the compact layout and on ignored targets", () => {
  const wide = mountPull({ enabled: false });
  wide.page.dispatch("pointerdown", { ...touchPointer, clientX: 100, clientY: 10 });
  wide.page.dispatch("pointermove", { ...touchPointer, clientX: 100, clientY: 210 });
  assert.equal(wide.pull.pullDistance.value, 0);
  wide.app.unmount();

  const compact = mountPull();
  compact.page.dispatch("pointerdown", {
    ...touchPointer,
    clientX: 100,
    clientY: 10,
    target: { closest: (selectors) => (selectors.includes("[data-shell-pull-refresh-ignore]") ? {} : null) }
  });
  compact.page.dispatch("pointermove", { ...touchPointer, clientX: 100, clientY: 210 });
  assert.equal(compact.pull.pullDistance.value, 0);
  compact.app.unmount();
});
