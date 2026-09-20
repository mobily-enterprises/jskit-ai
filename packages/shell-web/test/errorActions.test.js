import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { compileScript, parse } from "@vue/compiler-sfc";
import { createRenderer, defineComponent, h, nextTick } from "vue";
import { createPinia } from "pinia";
import { createErrorRuntime } from "../src/client/error/runtime.js";
import { createDefaultMaterialErrorPresenters } from "../src/client/error/presenters.js";
import { createErrorPresentationStore } from "../src/client/error/store.js";
import { useShellErrorPresentationStore } from "../src/client/stores/useShellErrorPresentationStore.js";

const componentUrl = new URL("../src/client/components/ShellErrorHost.vue", import.meta.url).href;
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url !== componentUrl) return nextLoad(url, context);
    const { descriptor } = parse(readFileSync(new URL(url), "utf8"));
    return { format: "module", shortCircuit: true,
      source: compileScript(descriptor, { id: "error-host", inlineTemplate: true }).content };
  }
});
const { default: ShellErrorHost } = await import(componentUrl);
hooks.deregister();

function fixture(t) {
  const node = (type, text = "") => ({ type, text, props: {}, children: [], parent: null });
  const renderer = createRenderer({
    createElement: node, createText: (text) => node("text", text), createComment: () => node("comment"),
    setText: (item, text) => { item.text = text; },
    setElementText: (item, text) => { item.text = text; item.children = []; },
    patchProp: (item, key, _previous, value) => { item.props[key] = value; },
    parentNode: (item) => item.parent,
    nextSibling: (item) => item.parent?.children[item.parent.children.indexOf(item) + 1] ?? null,
    insert(item, parent, anchor) {
      if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1);
      item.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(item); else parent.children.splice(index, 0, item);
    },
    remove(item) { if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1); }
  });
  const store = createErrorPresentationStore();
  const runtime = createErrorRuntime({
    presenters: createDefaultMaterialErrorPresenters({ store }),
    defaultPresenterId: "material.snackbar"
  });
  const app = renderer.createApp(ShellErrorHost);
  const pinia = createPinia();
  app.use(pinia);
  useShellErrorPresentationStore(pinia).attachRuntimeStore(store);
  app.provide("jskit.shell-web.runtime.web-error.client", runtime);
  for (const name of ["VSnackbar", "VDialog", "VCard", "VCardTitle", "VCardText", "VCardActions", "VSpacer", "VAlert", "VBtn"]) {
    app.component(name, defineComponent({ setup: (_props, { slots }) => () =>
      h(name, {}, [slots.default?.(), slots.actions?.()]) }));
  }
  const root = node("root");
  app.mount(root);
  t.after(() => app.unmount());
  const all = (item = root) => [item, ...item.children.flatMap((child) => all(child))];
  const button = (label) => all().find((item) => item.type === "VBtn" &&
    all(item).some((child) => child.text.trim() === label));
  return { runtime, store, all, button };
}

test("both snackbar actions survive the real runtime and render with independent handlers", async (t) => {
  const { runtime, store, all, button } = fixture(t);
  const calls = [];
  runtime.report({ message: "Delivered for booking", severity: "success",
    action: { label: "#142", handler: () => calls.push("booking"), dismissOnRun: false },
    additionalActions: [null, { label: "invalid" }, {
      label: " View message ", handler: async () => calls.push("message")
    }]
  });
  await nextTick();
  const entry = store.getState().channels.snackbar[0];
  assert.deepEqual(entry.additionalActions.map((action) => action.label), ["View message"]);
  assert.ok(Object.isFrozen(entry.additionalActions));
  assert.ok(Object.isFrozen(entry.additionalActions[0]));
  assert.equal(all().find((item) => item.type === "VSnackbar").props.vertical, true);
  await button("#142").props.onClick();
  assert.deepEqual(calls, ["booking"]);
  assert.equal(store.getState().channels.snackbar.length, 1);
  await button("View message").props.onClick();
  assert.deepEqual(calls, ["booking", "message"]);
  assert.equal(store.getState().channels.snackbar.length, 0);
});

test("additional-only actions work and rejected handlers use shared error reporting", async (t) => {
  const { runtime, store, button } = fixture(t);
  runtime.report({ message: "Delivered", additionalActions: [{ label: "View message",
    handler: async () => { throw new Error("Navigation failed"); }
  }] });
  await nextTick();
  assert.equal(store.getState().channels.snackbar[0].action, null);
  await button("View message").props.onClick();
  assert.equal(store.getState().channels.snackbar.length, 0);
  assert.equal(store.getState().channels.dialog[0].message, "Error action failed.");
});

test("policies can suppress additional actions and single actions still render", async (t) => {
  const { runtime, store, button, all } = fixture(t);
  runtime.setPolicy(() => ({ channel: "snackbar", additionalActions: [] }));
  let invoked = false;
  runtime.report({ message: "Saved", action: { label: "Undo", handler: () => { invoked = true; } },
    additionalActions: [{ label: "Hidden", handler() {} }] });
  await nextTick();
  assert.deepEqual(store.getState().channels.snackbar[0].additionalActions, []);
  assert.equal(button("Hidden"), undefined);
  assert.equal(all().find((item) => item.type === "VSnackbar").props.vertical, false);
  await button("Undo").props.onClick();
  assert.equal(invoked, true);
  assert.equal(store.getState().channels.snackbar.length, 0);
});
