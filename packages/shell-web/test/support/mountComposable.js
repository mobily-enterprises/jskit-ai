import { createRenderer, defineComponent } from "vue";

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

// Runs a composable inside a mounted component, with what the application provides.
function mountComposable(useComposable, { provide = [], plugins = [] } = {}) {
  let result = null;
  const app = renderer.createApp(defineComponent({
    setup() {
      result = useComposable();
      return () => null;
    }
  }));
  for (const plugin of plugins) {
    app.use(plugin);
  }
  for (const [key, value] of provide) {
    app.provide(key, value);
  }
  app.mount(node("root"));
  return { app, result };
}

// A window whose listeners a test can dispatch to, and a document with what the shell's composables read.
function installPage(t, { window: windowMembers = {}, document: documentMembers = {} } = {}) {
  const listeners = new Map();
  const classes = new Set();
  globalThis.window = {
    location: { href: "https://app.test/", origin: "https://app.test" },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
    ...windowMembers
  };
  globalThis.document = {
    documentElement: {
      classList: {
        toggle(name, enabled) {
          if (enabled) {
            classes.add(name);
          } else {
            classes.delete(name);
          }
        },
        remove(name) {
          classes.delete(name);
        }
      }
    },
    ...documentMembers
  };
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
  });
  return {
    classes,
    listeners,
    dispatch(type, event) {
      listeners.get(type)({ preventDefault() {}, target: { closest: () => null, setPointerCapture() {} }, ...event });
    }
  };
}

export { installPage, mountComposable };
