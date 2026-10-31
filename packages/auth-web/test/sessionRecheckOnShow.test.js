import assert from "node:assert/strict";
import test from "node:test";
import { createRenderer, defineComponent } from "vue";
import { useSessionRecheckOnShow } from "../src/client/composables/loginView/useSessionRecheckOnShow.js";

function node(type) {
  return { type, children: [], parent: null };
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

function createEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
    dispatch(type) {
      listeners.get(type)?.();
    }
  };
}

test("the sign-in page rechecks its session each time it is shown while mounted", (t) => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const page = createEventTarget();
  const pageDocument = Object.assign(createEventTarget(), { visibilityState: "visible" });
  globalThis.window = page;
  globalThis.document = pageDocument;
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });

  let rechecks = 0;
  const app = renderer.createApp(defineComponent({
    setup() {
      useSessionRecheckOnShow(() => {
        rechecks += 1;
      });
      return () => null;
    }
  }));
  app.mount(node("root"));

  page.dispatch("focus");
  page.dispatch("pageshow");
  pageDocument.dispatch("visibilitychange");
  assert.equal(rechecks, 3);

  pageDocument.visibilityState = "hidden";
  pageDocument.dispatch("visibilitychange");
  assert.equal(rechecks, 3, "a hidden page does not check");

  app.unmount();
  assert.equal(page.listeners.size, 0);
  assert.equal(pageDocument.listeners.size, 0);
});
