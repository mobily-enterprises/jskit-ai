import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const LOCATOR = new URL("../src/previewLocator.js", import.meta.url);
const CONTENT = new Set(["textContent", "innerText", "innerHTML", "outerHTML", "value", "nodeValue", "data", "attributes", "getAttribute"]);

// The locator as the Preview bridge inlines it: a classic script that defines
// one global function.
async function loadLocator() {
  const source = await readFile(LOCATOR, "utf8");
  assert.ok(Buffer.byteLength(source) <= 64 * 1024);
  const context = vm.createContext({});
  new vm.Script(source, { filename: "previewLocator.js" }).runInContext(context);
  assert.equal(typeof context.__vibe64LocateElement, "function");
  return context.__vibe64LocateElement;
}

// DOM nodes that record any read of element content.
function dom(reads) {
  const node = (fields) => new Proxy({ nodeType: 1, parentNode: null, ...fields }, {
    get(target, key) {
      if (CONTENT.has(key)) {
        reads.push(key);
      }
      return target[key];
    }
  });
  const app = { type: { __file: "/project/src/App.vue", __name: "App" }, parent: null };
  const card = { type: { __file: "/project/src/components/Card.vue", __name: "Card" }, parent: app };
  const libraryButton = { type: { name: "VBtn" }, parent: card };
  const root = node({ __vueParentComponent: app, textContent: "secret", value: "secret" });
  const section = node({ __vueParentComponent: card, parentNode: root, textContent: "secret" });
  const button = node({ __vueParentComponent: libraryButton, parentNode: section, value: "secret" });
  const label = node({ parentNode: button, textContent: "secret" });
  const text = node({ nodeType: 3, parentNode: label, data: "secret", nodeValue: "secret" });
  const orphan = node({ __vueParentComponent: { type: { name: "Library" }, parent: null } });
  const plain = node({ parentNode: node({ textContent: "secret" }) });
  return { root, section, button, label, text, orphan, plain };
}

test("the Vue locator names the nearest project component that rendered an element", async () => {
  const locate = await loadLocator();
  const reads = [];
  const nodes = dom(reads);
  assert.deepEqual({ ...locate(nodes.section) }, { file: "/project/src/components/Card.vue", name: "Card" });
  // A library component without a source file gives way to its project parent.
  assert.deepEqual({ ...locate(nodes.button) }, { file: "/project/src/components/Card.vue", name: "Card" });
  assert.deepEqual({ ...locate(nodes.label) }, { file: "/project/src/components/Card.vue", name: "Card" });
  assert.deepEqual({ ...locate(nodes.text) }, { file: "/project/src/components/Card.vue", name: "Card" });
  assert.deepEqual({ ...locate(nodes.root) }, { file: "/project/src/App.vue", name: "App" });
  assert.deepEqual(reads, []);
});

test("the Vue locator returns null for plain DOM and for components without a source file", async () => {
  const locate = await loadLocator();
  const reads = [];
  const nodes = dom(reads);
  assert.equal(locate(nodes.plain), null);
  assert.equal(locate(nodes.orphan), null);
  assert.equal(locate(null), null);
  assert.deepEqual(reads, []);
});

test("a component without a name is located by its file alone", async () => {
  const locate = await loadLocator();
  const element = { nodeType: 1, parentNode: null, __vueParentComponent: { type: { __file: "/project/src/Anonymous.vue" }, parent: null } };
  assert.deepEqual({ ...locate(element) }, { file: "/project/src/Anonymous.vue" });
});
