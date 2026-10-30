import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadCallProgram } from "../src/calls/program.js";
import { callsFrom, inspectCallsOf, project } from "./support.js";

const RESOLVED = {
  "src/lib/store.js": [
    "export class Store {",
    "  constructor(items) { this.items = items; }",
    "  list() { return this.items; }",
    "  count() { return this.list().length; }",
    "}",
    "export function formatName(name) { return `${name}!`; }",
    ""
  ].join("\n"),
  "src/lib/report.js": [
    "import { Store, formatName } from \"./store.js\";",
    "import * as names from \"./store.js\";",
    "export function report() {",
    "  const store = new Store([]);",
    "  store.count();",
    "  names.formatName(\"a\");",
    "  return formatName(\"b\");",
    "}",
    ""
  ].join("\n"),
  "src/components/Card.vue": [
    "<template><p>{{ label }}</p></template>",
    "<script setup>",
    "import { report } from \"../lib/report.js\";",
    "const label = report();",
    "</script>",
    ""
  ].join("\n")
};

test("checker-resolved project calls are exact, including Vue component scripts", async (t) => {
  const { result } = await inspectCallsOf(t, RESOLVED);
  const call = (callee) => {
    const [found] = callsFrom(result, callee);
    assert.ok(found, callee);
    return [found.resolution, found.certainty, found.method, found.fromFunctionId, found.targets];
  };
  assert.deepEqual(call("Store"), ["resolved", "exact", "checker", "fn:src/lib/report.js#3:8", ["fn:src/lib/store.js#2:3"]]);
  assert.deepEqual(call("store.count"), ["resolved", "exact", "checker", "fn:src/lib/report.js#3:8", ["fn:src/lib/store.js#4:3"]]);
  assert.deepEqual(call("this.list"), ["resolved", "exact", "checker", "fn:src/lib/store.js#4:3", ["fn:src/lib/store.js#3:3"]]);
  assert.deepEqual(call("names.formatName"), ["resolved", "exact", "checker", "fn:src/lib/report.js#3:8", ["fn:src/lib/store.js#6:8"]]);
  assert.deepEqual(call("formatName"), ["resolved", "exact", "checker", "fn:src/lib/report.js#3:8", ["fn:src/lib/store.js#6:8"]]);
  assert.deepEqual(call("report"), ["resolved", "exact", "checker", "fn:src/components/Card.vue#module", ["fn:src/lib/report.js#3:8"]]);
  // Builtins (`.length` aside, nothing here is a call) and evidence ranges.
  assert.equal(result.capabilities.calls, "complete");
  const vueCall = callsFrom(result, "report")[0];
  assert.deepEqual(vueCall.evidence, [{
    path: "src/components/Card.vue",
    hash: result.inputs.find((entry) => entry.path === "src/components/Card.vue").hash,
    start: { line: 4, column: 15 },
    end: { line: 4, column: 23 }
  }]);
});

test("call records keep the observation contract's shape and identity", async (t) => {
  const { result } = await inspectCallsOf(t, RESOLVED);
  const [record] = callsFrom(result, "store.count");
  assert.deepEqual(Object.keys(record), ["id", "resolution", "certainty", "method", "fromFunctionId", "targets", "callee", "evidence"]);
  // The identity is the callee name's position, so chained calls stay distinct.
  assert.equal(record.id, "call:jskit:src/lib/report.js#5:9");
  assert.equal(new Set(result.calls.map((entry) => entry.id)).size, result.calls.length);
});

test("the call program holds declared project scripts and TypeScript's libraries only", async (t) => {
  const source = {
    "src/use.js": "import { helper } from \"typed-package\";\nimport { local } from \"./local.js\";\nexport function use() { helper(); return local(); }\n",
    "src/local.js": "export function local() { return 1; }\n"
  };
  const { root } = await project(t, source, {
    undeclared: {
      "node_modules/typed-package/package.json": "{\"name\":\"typed-package\",\"types\":\"index.d.ts\"}",
      "node_modules/typed-package/index.d.ts": "export declare function helper(): void;\n",
      "node_modules/@types/node/index.d.ts": "declare module \"node:fs\" {}\n",
      "tsconfig.json": "{\"compilerOptions\":{\"types\":[\"node\"]}}",
      "src/undeclared.js": "export const hidden = 1;\n"
    }
  });
  const sources = new Map();
  for (const file of Object.keys(source)) {
    sources.set(file, await readFile(path.join(root, file), "utf8"));
  }
  const loaded = loadCallProgram({
    projectRoot: root,
    sources,
    resolveImport: (from, specifier) => specifier.startsWith(".") ? path.posix.join(path.posix.dirname(from), specifier) : null
  });
  const projectFiles = loaded.programFiles.filter((file) => !/(?:^|\/)lib\.[\w.]*\.d\.ts$/u.test(file));
  assert.deepEqual(projectFiles.sort(), ["src/local.js", "src/use.js"]);
  assert.ok(loaded.programFiles.some((file) => file.endsWith("lib.es2023.d.ts")));
  assert.ok(loaded.programFiles.every((file) => !file.includes("node_modules/typed-package") && !file.includes("@types")));
});

test("provably external calls are dropped and other unresolvable calls are kept", async (t) => {
  const { result } = await inspectCallsOf(t, {
    "src/server/tools.js": [
      "import { spawn } from \"node:child_process\";",
      "import { readdir } from \"node:fs/promises\";",
      "import { watch } from \"chokidar\";",
      "import * as fs from \"node:fs\";",
      "import { createServer } from \"node:http\";",
      "export async function run(task) {",
      "  const child = spawn(\"ls\");",
      "  child.kill();",
      "  let watcher = null;",
      "  watcher = watch(\".\");",
      "  watcher.close();",
      "  for (const entry of await readdir(\".\")) entry.isDirectory();",
      "  createServer().on(\"request\", (request, response) => response.writeHead(200));",
      "  await new Promise((resolve) => resolve());",
      "  fs.readFileSync(\"x\");",
      "  console.log(JSON.stringify([1].map((value) => value * 2)));",
      "  process.exit(0);",
      "  undeclaredHelper();",
      "  task.renderReport();",
      "}",
      ""
    ].join("\n"),
    "src/components/Item.vue": [
      "<template><button @click=\"save\">Save</button></template>",
      "<script setup>",
      "const props = defineProps({ onSave: Function });",
      "const emit = defineEmits([\"saved\"]);",
      "function save() { props.onSave(); emit(\"saved\"); }",
      "</script>",
      ""
    ].join("\n")
  });
  const callees = result.calls.map((call) => call.callee).sort();
  assert.deepEqual(callees, ["props.onSave", "task.renderReport", "undeclaredHelper"]);
  for (const call of result.calls) {
    assert.deepEqual([call.resolution, call.certainty, call.method, call.targets], ["unresolved", "unresolved", "none", []]);
  }
});

test("receiver names and argument flow are probable, never exact", async (t) => {
  const { result } = await inspectCallsOf(t, {
    "src/server/catalog.js": [
      "export const catalog = { list() { return []; }, filter(value) { return value; } };",
      "export const other = { filter(value) { return value; } };",
      "export function work() { return 1; }",
      ""
    ].join("\n"),
    "src/server/use.js": [
      "import { work } from \"./catalog.js\";",
      "function run(task) { return task(); }",
      "export function use(store, items) {",
      "  store.list();",
      "  items.filter(Boolean);",
      "  return run(work);",
      "}",
      ""
    ].join("\n")
  });
  const facts = (callee) => {
    const [call] = callsFrom(result, callee);
    return [call.resolution, call.certainty, call.method, call.targets];
  };
  assert.deepEqual(facts("store.list"), ["resolved", "probable", "receiver-name", ["fn:src/server/catalog.js#1:26"]]);
  assert.deepEqual(facts("items.filter"), ["ambiguous", "probable", "receiver-name", ["fn:src/server/catalog.js#1:49", "fn:src/server/catalog.js#2:24"]]);
  assert.deepEqual(facts("task"), ["resolved", "probable", "argument-flow", ["fn:src/server/catalog.js#3:8"]]);
});

const FEATURE = "import { defineFeature } from \"@jskit-ai/kernel/server/features\";";

test("defineFeature injection binds one provider exactly, several ambiguously and none not at all", async (t) => {
  const { result } = await inspectCallsOf(t, {
    "packages/store/src/server/feature.js": [
      FEATURE,
      "function createStore() { return { list() { return []; } }; }",
      "export default defineFeature({",
      "  provides: { store: \"demo.store\" },",
      "  setup() { const store = createStore(); return { store }; }",
      "});",
      ""
    ].join("\n"),
    "packages/cache/src/server/feature.js": [
      FEATURE,
      "export default defineFeature({",
      "  provides: { cache: \"demo.cache\" },",
      "  setup() { return { cache: { read() { return 1; } } }; }",
      "});",
      ""
    ].join("\n"),
    "packages/cache-copy/src/server/feature.js": [
      FEATURE,
      "export default defineFeature({",
      "  provides: { cache: \"demo.cache\" },",
      "  setup() { return { cache: { read() { return 2; } } }; }",
      "});",
      ""
    ].join("\n"),
    "packages/consumer/src/server/feature.js": [
      FEATURE,
      "export default defineFeature({",
      "  requires: { store: \"demo.store\", cache: \"demo.cache\", missing: \"demo.missing\" },",
      "  setup({ store, cache, missing }) {",
      "    store.list();",
      "    cache.read();",
      "    missing.reconcileNow();",
      "    return {};",
      "  }",
      "});",
      ""
    ].join("\n")
  });
  const facts = (callee) => {
    const [call] = callsFrom(result, callee);
    return [call.resolution, call.certainty, call.method, call.targets];
  };
  assert.deepEqual(facts("store.list"), ["resolved", "exact", "di-binding", ["fn:packages/store/src/server/feature.js#2:35"]]);
  assert.deepEqual(facts("cache.read"), ["ambiguous", "probable", "di-binding",
    ["fn:packages/cache/src/server/feature.js#4:31", "fn:packages/cache-copy/src/server/feature.js#4:31"]]);
  assert.deepEqual(facts("missing.reconcileNow"), ["unresolved", "unresolved", "none", []]);
});

test("a file's calls beyond the per-file bound are truncated and reported", async (t) => {
  const body = Array.from({ length: 2005 }, () => "  target();").join("\n");
  const { result } = await inspectCallsOf(t, { "src/many.js": `function target() {}\nexport function many() {\n${body}\n}\n` });
  assert.equal(result.calls.length, 2000);
  assert.equal(result.capabilities.calls, "partial");
  assert.ok(result.diagnostics.some((entry) => entry.code === "CALLS_TRUNCATED" && entry.path === "src/many.js"));
});

test("without --calls the output keeps its shape", async (t) => {
  const { root, input } = await project(t, RESOLVED);
  const { inspectVueArchitecture } = await import("../src/inspectVueArchitecture.js");
  const result = await inspectVueArchitecture({ projectRoot: root, input });
  for (const name of ["functions", "calls", "entryPoints"]) {
    assert.equal(name in result, false);
    assert.equal(name in result.capabilities, false);
  }
});
