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

test("receiver names are probable, never exact, and a passed function is reached exactly", async (t) => {
  const { result } = await inspectCallsOf(t, {
    "src/server/catalog.js": [
      "export const catalog = { listEntries() { return []; }, filter(value) { return value; } };",
      "export const other = { filter(value) { return value; } };",
      "export function work() { return 1; }",
      ""
    ].join("\n"),
    "src/server/use.js": [
      "import { work } from \"./catalog.js\";",
      "function run(task) { return task(); }",
      "export function use(store, items) {",
      "  store.listEntries();",
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
  assert.deepEqual(facts("store.listEntries"), ["resolved", "probable", "receiver-name", ["fn:src/server/catalog.js#1:26"]]);
  // `filter` is shared by two project functions and is an Array member.
  assert.deepEqual(facts("items.filter"), ["unresolved", "unresolved", "none", []]);
  // `run` calls `task` while it runs, so the caller that passes `work`, a
  // name bound to one function, reaches it exactly.
  assert.deepEqual(facts("task"), ["unresolved", "unresolved", "none", []]);
  assert.deepEqual(callsFrom(result, "run").map((call) => [call.resolution, call.certainty, call.method, call.targets]), [
    ["resolved", "exact", "checker", ["fn:src/server/use.js#2:1"]],
    ["resolved", "exact", "argument-flow", ["fn:src/server/catalog.js#3:8"]]
  ]);
});

test("a member name reaches a project function only when no other function or builtin shares it", async (t) => {
  const { result } = await inspectCallsOf(t, {
    "src/server/records.js": [
      "export const sessions = { readSessionRecord() { return 1; }, readSummary() { return []; } };",
      "export const projects = { readSummary() { return []; } };",
      "export const archive = { isDirectory() { return true; }, find() { return null; } };",
      ""
    ].join("\n"),
    "src/server/use.js": [
      "export function use(source, entry, values, bus) {",
      "  source.readSessionRecord();",
      "  source.readSummary();",
      "  entry.isDirectory();",
      "  values.find();",
      "  bus.emit(\"changed\");",
      "}",
      ""
    ].join("\n")
  });
  const facts = (callee) => callsFrom(result, callee).map((call) => [call.resolution, call.method, call.targets]);
  assert.deepEqual(facts("source.readSessionRecord"), [["resolved", "receiver-name", ["fn:src/server/records.js#1:27"]]]);
  // Shared by two project functions, or also a Node or JavaScript builtin member.
  for (const callee of ["source.readSummary", "entry.isDirectory", "values.find"]) {
    assert.deepEqual(facts(callee), [["unresolved", "none", []]], callee);
  }
  // A builtin member no project function declares is external.
  assert.deepEqual(facts("bus.emit"), []);
});

test("a callback a shared helper calls is reached from the caller that passes it, not from the helper", async (t) => {
  const { result } = await inspectCallsOf(t, {
    "src/server/result.js": [
      "export async function withResult(operation) {",
      "  try { return await operation(); } catch { return null; }",
      "}",
      "export function sessionResult(operation) { return withResult(operation); }",
      ""
    ].join("\n"),
    "src/server/routes.js": [
      "import { sessionResult, withResult } from \"./result.js\";",
      "function readSessions() { return []; }",
      "function readUsage() { return 1; }",
      "export function listSessions() { return withResult(readSessions); }",
      "export function usage() { return withResult(() => readUsage()); }",
      "export function forwarded() { return sessionResult(readSessions); }",
      ""
    ].join("\n"),
    "src/server/actions.js": [
      "export function createActions({ readStatus }) {",
      "  return { execute: () => readStatus() };",
      "}",
      ""
    ].join("\n"),
    "src/server/provider.js": [
      "import { createActions } from \"./actions.js\";",
      "function status() { return \"ok\"; }",
      "export function setup() { return createActions({ readStatus: status }); }",
      ""
    ].join("\n")
  });
  const id = (file, line) => result.functions.find((fn) => fn.file === file && fn.start.line === line && fn.kind !== "module").id;
  const reach = (start) => {
    const found = new Set([start]);
    for (const queue = [start]; queue.length;) {
      const from = queue.shift();
      for (const call of result.calls.filter((entry) => entry.fromFunctionId === from)) {
        for (const target of call.targets.filter((entry) => !found.has(entry))) {
          found.add(target);
          queue.push(target);
        }
      }
    }
    return [...found].sort();
  };
  const routes = (line) => id("src/server/routes.js", line);
  const withResult = id("src/server/result.js", 1);
  const sessionResult = id("src/server/result.js", 4);
  const usageCallback = result.functions.find((fn) => fn.file === "src/server/routes.js" && fn.kind === "arrow").id;
  assert.deepEqual(reach(routes(4)), [routes(2), routes(4), withResult].sort());
  assert.deepEqual(reach(routes(5)), [routes(3), routes(5), usageCallback, withResult].sort());
  // Forwarding a parameter to a helper that calls it counts as calling it.
  assert.deepEqual(reach(routes(6)), [routes(2), routes(6), sessionResult, withResult].sort());
  assert.deepEqual(reach(withResult), [withResult]);
  const passed = callsFrom(result, "withResult").find((call) => call.fromFunctionId === routes(4) && call.method === "argument-flow");
  assert.deepEqual([passed.resolution, passed.certainty, passed.targets], ["resolved", "exact", [routes(2)]]);
  assert.deepEqual(callsFrom(result, "operation").map((call) => [call.fromFunctionId, call.certainty, call.targets]),
    [[withResult, "unresolved", []]]);
  // A closure the helper returns may run later, so it keeps the passed values;
  // its only caller passes one function, so the closure reaches it exactly.
  const [later] = callsFrom(result, "readStatus");
  assert.deepEqual([later.certainty, later.method, later.targets], ["exact", "argument-flow", [id("src/server/provider.js", 2)]]);
  assert.deepEqual(callsFrom(result, "createActions").map((call) => call.method), ["checker"]);
});

test("argument flow is exact when a parameter has one value across the project, probable with several", async (t) => {
  const { result } = await inspectCallsOf(t, {
    "src/server/service.js": [
      "export function createService() {",
      "  return { listRecords() { return []; } };",
      "}",
      ""
    ].join("\n"),
    "src/server/actions.js": [
      "export function createActions({ records }) {",
      "  return { execute: () => records.listRecords() };",
      "}",
      "export function createReader(read) {",
      "  return { execute: () => read() };",
      "}",
      ""
    ].join("\n"),
    "src/server/provider.js": [
      "import { createService } from \"./service.js\";",
      "import { createActions, createReader } from \"./actions.js\";",
      "function first() { return 1; }",
      "function second() { return 2; }",
      "export function setup() {",
      "  const records = createService();",
      "  createReader(first);",
      "  createReader(second);",
      "  return createActions({ records });",
      "}",
      ""
    ].join("\n")
  });
  const facts = (callee) => callsFrom(result, callee).map((call) => [call.resolution, call.certainty, call.method, call.targets]);
  // One caller injects the service, so the factory's closure reaches it exactly.
  assert.deepEqual(facts("records.listRecords"), [["resolved", "exact", "argument-flow", ["fn:src/server/service.js#2:12"]]]);
  // Two callers pass different functions, so either may run.
  assert.deepEqual(facts("read"), [["ambiguous", "probable", "argument-flow", ["fn:src/server/provider.js#3:1", "fn:src/server/provider.js#4:1"]]]);
});

test("a destructured name reaches the function its source's property holds, wherever it is called", async (t) => {
  const { result } = await inspectCallsOf(t, {
    "src/server/access.js": [
      "export function createRecordAccess(repository) {",
      "  function requireAsset(id) { return repository.find(id); }",
      "  function listAssets() { return []; }",
      "  return { requireAsset, listAssets, audit: { record(entry) { return entry; } } };",
      "}",
      ""
    ].join("\n"),
    "src/server/use.js": [
      "import { createRecordAccess } from \"./access.js\";",
      "function useAccess(access) { return access.requireAsset(2); }",
      "export function direct(repository) {",
      "  const { requireAsset, listAssets: list, audit: { record } } = createRecordAccess(repository);",
      "  requireAsset(1);",
      "  list();",
      "  record({});",
      "  return useAccess({ requireAsset });",
      "}",
      "export function createService(repository) {",
      "  const { requireAsset } = createRecordAccess(repository);",
      "  return { requireAsset };",
      "}",
      "export function viaReturn(repository) { return createService(repository).requireAsset(3); }",
      "/** @param {ReturnType<typeof createRecordAccess>} access */",
      "export function viaParameter({ requireAsset: need, audit: { record: write } }) { need(4); return write({}); }",
      "export function untyped({ requireAsset }) { return requireAsset(5); }",
      ""
    ].join("\n")
  });
  const facts = (callee) => callsFrom(result, callee).map((call) => [call.fromFunctionId.replace("fn:src/server/use.js#", ""), call.certainty, call.method, call.targets]);
  const REQUIRE = "fn:src/server/access.js#2:3";
  const RECORD = "fn:src/server/access.js#4:47";
  assert.deepEqual(facts("requireAsset"), [["3:8", "exact", "checker", [REQUIRE]], ["17:8", "unresolved", "none", []]]);
  // A renamed binding reads the property it names; a nested pattern reads its parent's property.
  assert.deepEqual(facts("list"), [["3:8", "exact", "checker", ["fn:src/server/access.js#3:3"]]]);
  assert.deepEqual(facts("record"), [["3:8", "exact", "checker", [RECORD]]]);
  // Passed on in `{ requireAsset }`, and returned in it.
  assert.deepEqual(facts("access.requireAsset"), [["2:1", "exact", "argument-flow", [REQUIRE]]]);
  assert.deepEqual(facts("createService(repository).requireAsset"), [["14:8", "exact", "checker", [REQUIRE]]]);
  // A typed parameter's pattern reads the parameter's type; an untyped one reaches nothing.
  assert.deepEqual(facts("need"), [["16:8", "exact", "checker", [REQUIRE]]]);
  assert.deepEqual(facts("write"), [["16:8", "exact", "checker", [RECORD]]]);
});

test("a function passed on through JSDoc-typed destructured parameters reaches its callers' value", async (t) => {
  const typedParameter = (name) => [
    "/** @typedef {import(\"./types.js\").Access} Access */",
    "/**",
    " * @param {object} dependencies",
    " * @param {Access[\"requireAsset\"]} dependencies.requireAsset",
    " */",
    `function ${name}({ requireAsset }) {`
  ];
  const { result } = await inspectCallsOf(t, {
    "src/server/types.js": "/** @typedef {ReturnType<typeof import(\"./access.js\").createAccess>} Access */\nexport {};\n",
    "src/server/access.js": "export function createAccess() {\n  async function requireAsset(id) { return id; }\n  return Object.freeze({ requireAsset });\n}\n",
    "src/server/completion.js": [
      ...typedParameter("createCompletion"),
      "  async function correct(id) { await requireAsset(id); }",
      "  return { correct };",
      "}",
      "export { createCompletion };",
      ""
    ].join("\n"),
    "src/server/execution.js": [
      "import { createCompletion } from \"./completion.js\";",
      ...typedParameter("createExecution"),
      "  async function group(id) { await requireAsset(id); }",
      "  const { correct } = createCompletion({ requireAsset });",
      "  return { group, correct };",
      "}",
      "export { createExecution };",
      ""
    ].join("\n"),
    "src/server/service.js": [
      "import { createAccess } from \"./access.js\";",
      "import { createExecution } from \"./execution.js\";",
      "export function createService() {",
      "  const { requireAsset } = createAccess();",
      "  return createExecution({ requireAsset });",
      "}",
      ""
    ].join("\n")
  });
  const facts = callsFrom(result, "requireAsset").map((call) => [call.fromFunctionId, call.certainty, call.method, call.targets]);
  const REQUIRE = "fn:src/server/access.js#2:3";
  // One hop (execution's own call) and two (completion, given execution's parameter).
  assert.deepEqual(facts, [
    ["fn:src/server/completion.js#7:3", "exact", "argument-flow", [REQUIRE]],
    ["fn:src/server/execution.js#8:3", "exact", "argument-flow", [REQUIRE]]
  ]);
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

// A capability's type as its providing package exports it, from
// `./server/types`, and the other JSDoc forms a feature receives
// collaborators through.
const TYPED = {
  "package.json": "{}",
  "packages/booking/src/server/bookingEngine.js": [
    "export function createBookingEngine() {",
    "  function readStatus(input) { return input; }",
    "  return Object.freeze({ readStatus });",
    "}",
    ""
  ].join("\n"),
  "packages/booking/src/server/types.js": [
    "// The type of the `feature.booking-engine` capability.",
    "/** @typedef {ReturnType<typeof import(\"./bookingEngine.js\").createBookingEngine>} BookingEngine */",
    "export {};",
    ""
  ].join("\n"),
  "packages/booking/src/server/installers.js": [
    "export class Store { list() { return []; } }",
    "export function installJdk() { return 1; }",
    "export function installNode() { return 2; }",
    "export const defaultInstallers = Object.freeze({ installJdk, installNode });",
    ""
  ].join("\n"),
  "src/server/use.js": [
    "/** @typedef {import(\"@local/booking/server/types\").BookingEngine} BookingEngine */",
    "/** @typedef {object} Tools",
    " * @property {typeof import(\"@local/booking/server/installers\").installNode} install */",
    "/** @param {BookingEngine} bookingEngine */",
    "export function viaTypedef(bookingEngine) { return bookingEngine.readStatus({}); }",
    "/** @param {{ engine: import(\"@local/booking/server/types\").BookingEngine }} capabilities */",
    "export function viaCapabilities({ engine }) { return engine.readStatus({}); }",
    "/** @param {import(\"@local/booking/server/installers\").Store} store */",
    "export function viaClass(store) { return store.list(); }",
    "/** @param {{ installJdk: typeof import(\"@local/booking/server/installers\").installJdk }} installers */",
    "export function viaTypeofMember(installers) { return installers.installJdk(); }",
    "/** @param {typeof import(\"@local/booking/server/installers\").defaultInstallers} installers */",
    "export function viaNamedDefault(installers) { return installers.installNode(); }",
    "/** @param {Tools} tools */",
    "export function viaPropertyTag(tools) { return tools.install(); }",
    "/** @type {BookingEngine | null} */",
    "let held = null;",
    "export function viaTypedBinding() { return held.readStatus({}); }",
    ""
  ].join("\n")
};

test("calls through JSDoc-typed parameters and bindings resolve through the checker", async (t) => {
  const { result } = await inspectCallsOf(t, TYPED, {
    packages: [{ id: "package:booking", name: "@local/booking", root: "packages/booking", manifest: "package.json", opaque: false,
      entryPoints: [{ importPath: "./server/types", file: "packages/booking/src/server/types.js" }, { importPath: "./server/*", file: "packages/booking/src/server/*.js" }] }]
  });
  const facts = result.calls.map((call) => [call.fromFunctionId.replace("fn:src/server/use.js#", ""), call.callee, call.certainty, call.method, call.targets]);
  const READ = "fn:packages/booking/src/server/bookingEngine.js#2:3";
  assert.deepEqual(facts, [
    ["5:8", "bookingEngine.readStatus", "exact", "checker", [READ]],
    ["7:8", "engine.readStatus", "exact", "checker", [READ]],
    ["9:8", "store.list", "exact", "checker", ["fn:packages/booking/src/server/installers.js#1:22"]],
    // A member a type declares as `typeof` a function is that function.
    ["11:8", "installers.installJdk", "exact", "checker", ["fn:packages/booking/src/server/installers.js#2:8"]],
    ["13:8", "installers.installNode", "exact", "checker", ["fn:packages/booking/src/server/installers.js#3:8"]],
    ["15:8", "tools.install", "exact", "checker", ["fn:packages/booking/src/server/installers.js#3:8"]],
    ["18:8", "held.readStatus", "exact", "checker", [READ]]
  ]);
});

// A monorepo: packages/app declares @local/booking in its own manifest's
// dependencies; the root manifest declares nothing.
const WORKSPACE = {
  "package.json": "{}",
  "packages/booking/package.json": "{}",
  "packages/booking/src/server/bookingEngine.js": TYPED["packages/booking/src/server/bookingEngine.js"],
  "packages/booking/src/server/types.js": TYPED["packages/booking/src/server/types.js"],
  "packages/app/package.json": "{}",
  "packages/app/src/server/use.js": [
    "/** @param {import(\"@local/booking/server/types\").BookingEngine} engine */",
    "export function viaWorkspaceDependency(engine) { return engine.readStatus({}); }",
    ""
  ].join("\n"),
  "src/server/use.js": [
    "/** @param {import(\"@local/booking/server/types\").BookingEngine} engine */",
    "export function viaUndeclaredPackage(engine) { return engine.readStatus({}); }",
    ""
  ].join("\n")
};

test("a workspace package resolves for the files of each manifest that declares it, whatever the dependency kind", async (t) => {
  const READ = "fn:packages/booking/src/server/bookingEngine.js#2:3";
  for (const kind of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const { result } = await inspectCallsOf(t, WORKSPACE, {
      packages: [{ id: "package:booking", name: "@local/booking", root: "packages/booking", manifest: "packages/app/package.json", opaque: false,
        declarations: [{ manifest: "packages/app/package.json", requested: "0.1.0", dependencyKinds: [kind] }],
        entryPoints: [{ importPath: "./server/types", file: "packages/booking/src/server/types.js" }] }]
    });
    const facts = result.calls.map((call) => [call.fromFunctionId, call.certainty, call.method, call.targets]);
    assert.deepEqual(facts, [
      ["fn:packages/app/src/server/use.js#2:8", "exact", "checker", [READ]],
      // The root manifest does not declare the package, so its type stays unknown.
      ["fn:src/server/use.js#2:8", "probable", "receiver-name", [READ]]
    ], kind);
  }
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
